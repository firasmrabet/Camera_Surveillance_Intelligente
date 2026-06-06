import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * useMjpegStream — Streams a multipart/x-mixed-replace MJPEG feed and exposes
 * the latest frame as a blob URL suitable for an <img src>.
 *
 * Browsers do NOT render `multipart/x-mixed-replace` directly in <img src>
 * (Chrome, Edge, Firefox all reject it). This hook fetches the stream,
 * parses the multipart boundaries, decodes each JPEG, and rotates the
 * blob URL so the <img> updates ~1x per second (or as fast as the source).
 *
 * Usage:
 *   const { frameUrl, isActive, error, fps, restart } = useMjpegStream(streamUrl);
 *   <img src={frameUrl || ''} />
 */
export function useMjpegStream(url, options = {}) {
  const { autoStart = true, maxFps = 0, imgRef: externalImgRef } = options;
  const [frameUrl, setFrameUrl] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState(null);
  const [fps, setFps] = useState(0);

  const abortRef = useRef(null);
  const urlRef = useRef(null);
  const lastFrameUrlRef = useRef(null);
  const fpsSamplesRef = useRef([]);
  const restartFnRef = useRef(null);
  const hasEmittedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch (_) {}
      abortRef.current = null;
    }
    if (lastFrameUrlRef.current) {
      try { URL.revokeObjectURL(lastFrameUrlRef.current); } catch (_) {}
      lastFrameUrlRef.current = null;
    }
    setFrameUrl(null);
    setIsActive(false);
  }, []);

  const restart = useCallback(() => {
    cleanup();
    if (urlRef.current) {
      // small delay to let cleanup propagate
      setTimeout(() => startStream(urlRef.current), 200);
    }
  }, [cleanup]);

  restartFnRef.current = restart;

  const startStream = useCallback(async (streamUrl) => {
    if (!streamUrl) return;
    cleanup();
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    // Build headers — include JWT for server-side auth (auth middleware uses Bearer token)
    const headers = {
      'User-Agent': 'SentinelAI-Web/1.0',
      'Accept': 'multipart/x-mixed-replace, image/jpeg, image/*, */*'
    };
    try {
      const token = localStorage.getItem('token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch (_) { /* localStorage may be blocked */ }

    try {
      const response = await fetch(streamUrl, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers,
        signal: controller.signal
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error('401 Unauthorized — please log in again');
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      if (!response.body) throw new Error('No response body (stream)');

      // Extract boundary from Content-Type header
      const ct = response.headers.get('content-type') || '';
      const boundaryMatch = ct.match(/boundary=([^;]+)/i);
      if (!boundaryMatch) throw new Error('No multipart boundary in Content-Type');
      // RFC 2046: delimiter is "--" + boundary value. But IP Webcam (and some others)
      // include the "--" in the boundary value itself, so don't double-prepend.
      const rawBoundary = boundaryMatch[1].trim();
      const boundary = rawBoundary.startsWith('--') ? rawBoundary : `--${rawBoundary}`;
      const boundaryBytes = new TextEncoder().encode(boundary);
      const crlf = new Uint8Array([0x0d, 0x0a]);
      const dblCrlf = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]);

      setIsActive(true);
      setError(null);

      const reader = response.body.getReader();
      let buffer = new Uint8Array(0);
      let lastFrameAt = 0;

      const findIndex = (haystack, needle, startFrom = 0) => {
        outer: for (let i = startFrom; i <= haystack.length - needle.length; i++) {
          for (let j = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) continue outer;
          }
          return i;
        }
        return -1;
      };

      while (!cancelled) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          const next = new Uint8Array(buffer.length + value.length);
          next.set(buffer, 0);
          next.set(value, buffer.length);
          buffer = next;
        }

        // Try to extract frames in a loop
        // (there may be multiple frames per read)
        let safety = 8;
        while (safety-- > 0) {
          // Find a boundary at the start of a frame
          let bIdx = findIndex(buffer, boundaryBytes, 0);
          if (bIdx < 0) break;
          // Skip past the boundary line and headers
          let scan = bIdx + boundaryBytes.length;
          // Skip any leading \r\n
          while (scan < buffer.length && (buffer[scan] === 0x0d || buffer[scan] === 0x0a)) scan++;
          // Find header/body separator (CRLFCRLF)
          const sepIdx = findIndex(buffer, dblCrlf, scan);
          if (sepIdx < 0) break;
          const headers = new TextDecoder().decode(buffer.slice(scan, sepIdx));
          const bodyStart = sepIdx + 4;
          let frameLen = 0;
          let frameEnd = -1;
          const lenMatch = headers.match(/content-length:\s*(\d+)/i);
          if (lenMatch) {
            frameLen = parseInt(lenMatch[1], 10);
            if (buffer.length < bodyStart + frameLen) break; // need more data
            frameEnd = bodyStart + frameLen;
          } else {
            // No Content-Length — find the next boundary to determine frame size
            // (IP Webcam MJPEG doesn't send Content-Length, so we have to scan)
            const nextBIdx = findIndex(buffer, boundaryBytes, bodyStart);
            if (nextBIdx < 0) break; // need more data
            // The body is everything up to the next boundary, minus trailing CRLF
            frameEnd = nextBIdx;
            while (frameEnd > bodyStart && (buffer[frameEnd - 1] === 0x0d || buffer[frameEnd - 1] === 0x0a)) {
              frameEnd--;
            }
            frameLen = frameEnd - bodyStart;
          }
          if (frameLen <= 0) { buffer = buffer.slice(sepIdx + 4); continue; }
          // Extract JPEG bytes
          const jpegBytes = buffer.slice(bodyStart, frameEnd);
          // Validate JPEG magic bytes (FF D8 FF) to avoid rendering garbage
          if (jpegBytes.length >= 3 && jpegBytes[0] === 0xFF && jpegBytes[1] === 0xD8 && jpegBytes[2] === 0xFF) {
            // Advance buffer: skip past body + trailing CRLF + boundary
            let nextStart = frameEnd;
            // Skip trailing CRLF before next boundary
            while (nextStart + 1 < buffer.length &&
                   buffer[nextStart] === 0x0d && buffer[nextStart + 1] === 0x0a) {
              nextStart += 2;
              break; // only consume one CRLF (the boundary follows)
            }
            buffer = buffer.slice(nextStart);

            // Throttle frames if needed
            const now = performance.now();
            if (maxFps > 0 && lastFrameAt > 0 && (now - lastFrameAt) < 1000 / maxFps) {
              continue;
            }
            lastFrameAt = now;

            // Create blob URL
            const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
            const newUrl = URL.createObjectURL(blob);
            const prev = lastFrameUrlRef.current;
            lastFrameUrlRef.current = newUrl;

            // KEY OPTIMIZATION: set src directly on img element via ref.
            // This AVOIDS React state updates (setFrameUrl) on every frame,
            // which would cause the entire CameraView to re-render 10+ times
            // per second. The browser handles the img.src change natively.
            if (externalImgRef && externalImgRef.current) {
              externalImgRef.current.src = newUrl;
            }

            // First frame only: trigger ONE React state update so the consumer
            // (CameraView) knows the stream is active and renders the <img> element.
            if (!hasEmittedRef.current) {
              hasEmittedRef.current = true;
              setFrameUrl(newUrl);
              setIsActive(true);
            } else if (!(externalImgRef && externalImgRef.current)) {
              // No imgRef available — fall back to state-based updates
              // (slightly slower but works without a dedicated img element).
              setFrameUrl(newUrl);
            }

            if (prev) {
              // 500ms delay gives the browser time to decode the new frame
              setTimeout(() => { try { URL.revokeObjectURL(prev); } catch (_) {} }, 500);
            }

            // Update FPS counter (throttled to ~1 Hz to minimize re-renders)
            const fpsNow = performance.now();
            const samples = fpsSamplesRef.current;
            if (samples.length === 0 || fpsNow - samples[samples.length - 1] > 1000) {
              samples.push(fpsNow);
              while (samples.length > 0 && fpsNow - samples[0] > 5000) samples.shift();
              if (samples.length >= 2) {
                const span = (fpsNow - samples[0]) / 1000;
                setFps(Math.round((samples.length - 1) / span * 10) / 10);
              }
            }
          } else {
            // Bad JPEG — skip 4 bytes and try again
            buffer = buffer.slice(sepIdx + 4);
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('[MJPEG] stream error:', e.message);
        setError(e.message);
        setIsActive(false);
      }
    } finally {
      cancelled = true;
    }
  }, [cleanup, maxFps]);

  useEffect(() => {
    urlRef.current = url;
    if (autoStart && url) {
      startStream(url);
    }
    return () => {
      cleanup();
    };
  }, [url, autoStart, startStream, cleanup]);

  return { frameUrl, isActive, error, fps, restart };
}
