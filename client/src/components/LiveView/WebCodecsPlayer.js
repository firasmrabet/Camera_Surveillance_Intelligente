import { Muxer, StreamTarget } from 'mp4-muxer';

/**
 * WebCodecsPlayer — H.264 live streamer via WebCodecs + MediaSource Extensions
 *
 * Pipeline:
 *   JPEG bytes (from server MJPEG parser) → ImageBitmap → VideoFrame
 *      → VideoEncoder (H.264) → EncodedVideoChunk → mp4-muxer (fMP4)
 *      → SourceBuffer.appendBuffer() → <video> element
 *
 * Target quality: TikTok/Instagram Live (H.264 baseline, 1.5 Mbps, 30 FPS, ~1s GOP).
 * Latency: ~200-500ms end-to-end (capture → screen).
 *
 * Fallback: if WebCodecs or MSE is not available (Safari < 16.4, Firefox),
 * the component reports unsupported and the parent can use the canvas fallback.
 */
export class WebCodecsPlayer {
  static isSupported() {
    return typeof window !== 'undefined' &&
           'VideoEncoder' in window &&
           'VideoFrame' in window &&
           'MediaSource' in window &&
           typeof window.MediaSource === 'function';
  }

  constructor(videoEl, options = {}) {
    this.videoEl = videoEl;
    this.bitrate = options.bitrate || 1_500_000;
    this.framerate = options.framerate || 30;
    this.gopInterval = options.gopInterval || 30; // 1s keyframe at 30 FPS
    this.onFps = options.onFps || (() => {});
    this.onError = options.onError || (() => {});
    this.onState = options.onState || (() => {});

    this.encoder = null;
    this.muxer = null;
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.decoderConfig = null;
    this.isOpen = false;
    this.frameCount = 0;
    this.lastFpsUpdate = 0;
    this.startedAt = 0;
    this._width = 0;
    this._height = 0;
    this._pendingAppends = [];
    this._abortController = null;
  }

  async start(width = 1280, height = 720) {
    if (!WebCodecsPlayer.isSupported()) {
      const err = new Error('WebCodecs not supported in this browser');
      this.onError(err);
      throw err;
    }

    if (this.mediaSource) {
      this.stop();
    }

    this._width = width;
    this._height = height;
    this._abortController = new AbortController();
    this.onState('starting');

    try {
      // Find a supported codec BEFORE we start — avoid MediaSource timeout
      const codecInfo = await this._pickSupportedCodec();
      if (!codecInfo) {
        throw new Error('No supported video codec found (tried H.264, VP9, AV1)');
      }
      console.log(`[WebCodecsPlayer] Using codec: ${codecInfo.codec} (${codecInfo.muxerCodec})`);

      // Wait for the video element to be in the DOM (in case of async render)
      await this._waitForVideoElement();

      // Detach any prior src (avoids React re-render resetting our blob URL)
      if (this.videoEl.src && this.videoEl.src.startsWith('blob:')) {
        try { this.videoEl.removeAttribute('src'); } catch (_) {}
        this.videoEl.load();
      }

      this.mediaSource = new MediaSource();
      const objectUrl = URL.createObjectURL(this.mediaSource);
      this._objectUrl = objectUrl;
      this.videoEl.src = objectUrl;

      await new Promise((resolve, reject) => {
        let resolved = false;
        const onOpen = () => {
          if (resolved) return;
          resolved = true;
          this.mediaSource.removeEventListener('sourceopen', onOpen);
          this.mediaSource.removeEventListener('error', onError);
          resolve();
        };
        const onError = (e) => {
          if (resolved) return;
          resolved = true;
          this.mediaSource.removeEventListener('sourceopen', onOpen);
          this.mediaSource.removeEventListener('error', onError);
          reject(new Error('MediaSource error: ' + (e?.message || 'unknown')));
        };
        this.mediaSource.addEventListener('sourceopen', onOpen);
        this.mediaSource.addEventListener('error', onError);
        setTimeout(() => {
          if (resolved) return;
          resolved = true;
          this.mediaSource.removeEventListener('sourceopen', onOpen);
          this.mediaSource.removeEventListener('error', onError);
          reject(new Error('MediaSource open timeout (browser may not support the codec in MSE)'));
        }, 5000);
      });

      this.isOpen = true;
      this._setupSourceBufferWithCodec(codecInfo);
      this._setupMuxer(codecInfo);
      this._setupEncoderWithCodec(codecInfo);

      this.startedAt = performance.now();
      this.lastFpsUpdate = this.startedAt;
      this.frameCount = 0;
      this.onState('streaming');

      this.videoEl.muted = true;
      this.videoEl.playsInline = true;
      this.videoEl.autoplay = true;
      await this.videoEl.play().catch((e) => {
        console.warn('[WebCodecsPlayer] autoplay blocked:', e.message);
      });
    } catch (e) {
      this.onError(e);
      this.onState('error');
      throw e;
    }
  }

  async _waitForVideoElement() {
    // Ensure the video element is attached to the DOM and has dimensions.
    // Without this, MediaSource's sourceopen event may never fire on some browsers.
    if (!this.videoEl) throw new Error('Video element not available');

    let attempts = 0;
    while (attempts++ < 50) {
      const inDom = this.videoEl.isConnected && document.body.contains(this.videoEl);
      const hasSize = (this.videoEl.clientWidth > 0 || this.videoEl.clientHeight > 0) ||
                      (this.videoEl.offsetWidth > 0 || this.videoEl.offsetHeight > 0);
      if (inDom && (hasSize || attempts > 10)) {
        return;
      }
      await new Promise(r => setTimeout(r, 20));
    }
  }

  async _pickSupportedCodec() {
    // Order matters: try the most widely supported and best-compressed first
    // Modern Chromium-based browsers may not include H.264 encoders (patent-free push)
    // so we MUST fall back to VP9/AV1. Edge on Windows usually has H.264 though.
    const candidates = [
      // H.264 (avc) — best for compatibility, hardware-accelerated on most devices
      { codec: 'avc1.42001F', muxerCodec: 'avc', mime: 'video/mp4; codecs="avc1.42001F"' },
      { codec: 'avc1.42E01F', muxerCodec: 'avc', mime: 'video/mp4; codecs="avc1.42E01F"' },
      { codec: 'avc1.640028', muxerCodec: 'avc', mime: 'video/mp4; codecs="avc1.640028"' },
      // VP9 — open codec, good quality, well supported in Chromium
      { codec: 'vp09.00.10.08', muxerCodec: 'vp9', mime: 'video/mp4; codecs="vp09.00.10.08"' },
      { codec: 'vp9', muxerCodec: 'vp9', mime: 'video/mp4; codecs="vp9"' },
      // AV1 — best compression, slower, but new
      { codec: 'av01.0.04M.08', muxerCodec: 'av1', mime: 'video/mp4; codecs="av01.0.04M.08"' }
    ];
    const survey = [];
    for (const c of candidates) {
      const msOk = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(c.mime);
      let encOk = false;
      // VideoEncoder.isConfigSupported is ASYNC (returns a Promise)
      try {
        if (typeof VideoEncoder !== 'undefined') {
          const cfg = this._buildEncoderConfig(c.codec, c.muxerCodec);
          const r = await VideoEncoder.isConfigSupported(cfg);
          encOk = !!r.supported;
        }
      } catch (_) {
        encOk = false;
      }
      survey.push({ ...c, msOk, encOk });
      if (msOk && encOk) {
        console.log(`[WebCodecsPlayer] Codec OK: ${c.codec} (ms=${msOk}, enc=${encOk})`);
        return c;
      }
    }
    console.warn('[WebCodecsPlayer] No codec fully supported. Survey:');
    for (const s of survey) {
      console.warn(`  ${s.codec}: ms=${s.msOk} enc=${s.encOk}`);
    }
    return null;
  }

  _buildEncoderConfig(codec, muxerCodec) {
    const cfg = {
      codec,
      width: this._width,
      height: this._height,
      bitrate: this.bitrate,
      framerate: this.framerate,
      latencyMode: 'realtime'
    };
    if (muxerCodec === 'avc') {
      cfg.avc = { format: 'avc' };
    }
    return cfg;
  }

  _setupSourceBufferWithCodec(codecInfo) {
    const mime = `video/mp4; codecs="${codecInfo.codec}"`;
    if (!MediaSource.isTypeSupported(mime)) {
      throw new Error(`Codec not supported by MediaSource: ${mime}`);
    }
    this.sourceBuffer = this.mediaSource.addSourceBuffer(mime);
    this.sourceBuffer.mode = 'segments';
    this.sourceBuffer.addEventListener('error', (e) => {
      this.onError(new Error('SourceBuffer error'));
    });
  }

  _setupMuxer(codecInfo) {
    this.muxer = new Muxer({
      target: new StreamTarget({
        onData: (data, position) => this._enqueueAppend(data)
      }),
      video: {
        codec: codecInfo.muxerCodec,
        width: this._width,
        height: this._height,
        frameRate: this.framerate
      },
      fastStart: 'fragmented',
      firstTimestampBehavior: 'offset',
      minFragmentDuration: 0.5
    });
  }

  _setupEncoderWithCodec(codecInfo) {
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta),
      error: (e) => this.onError(e)
    });

    const cfg = this._buildEncoderConfig(codecInfo.codec, codecInfo.muxerCodec);

    try {
      this.encoder.configure(cfg);
    } catch (e) {
      // Try without avc.format (some encoders prefer annexb)
      if (codecInfo.muxerCodec === 'avc') {
        try {
          const altCfg = { ...cfg, avc: { format: 'annexb' } };
          this.encoder.configure(altCfg);
          return;
        } catch (e2) {
          throw new Error(`VideoEncoder config failed for ${codecInfo.codec}: ${e.message} (annexb also failed: ${e2.message})`);
        }
      }
      throw new Error(`VideoEncoder config failed for ${codecInfo.codec}: ${e.message}`);
    }
  }

  _enqueueAppend(data) {
    if (!this.sourceBuffer) return;
    this._pendingAppends.push(data);
    this._drainAppends();
  }

  _drainAppends() {
    if (!this.sourceBuffer) return;
    if (this.sourceBuffer.updating) return;
    if (this._pendingAppends.length === 0) return;

    // Coalesce multiple pending appends to reduce overhead
    if (this._pendingAppends.length > 1) {
      const totalLen = this._pendingAppends.reduce((s, a) => s + a.byteLength, 0);
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const a of this._pendingAppends) {
        merged.set(a, offset);
        offset += a.byteLength;
      }
      this._pendingAppends = [];
      this._appendBuffer(merged);
    } else {
      const data = this._pendingAppends.shift();
      this._appendBuffer(data);
    }
  }

  _appendBuffer(data) {
    if (!this.sourceBuffer) return;
    try {
      this.sourceBuffer.addEventListener('updateend', () => this._drainAppends(), { once: true });
      this.sourceBuffer.appendBuffer(data);
    } catch (e) {
      this.onError(new Error('appendBuffer failed: ' + e.message));
    }
  }

  /**
   * Add a JPEG frame from the server.
   * @param {ArrayBuffer|Uint8Array} jpegBuffer
   * @param {number} timestamp - microseconds, optional
   */
  async addFrame(jpegBuffer, timestamp) {
    if (!this.encoder || !this.isOpen) return;
    if (this._abortController?.signal.aborted) return;

    // Backpressure: skip if encoder is backed up
    if (this.encoder.encodeQueueSize > 8) {
      return;
    }

    const buffer = jpegBuffer instanceof ArrayBuffer
      ? jpegBuffer
      : jpegBuffer.buffer.slice(jpegBuffer.byteOffset, jpegBuffer.byteOffset + jpegBuffer.byteLength);

    let bitmap = null;
    let frame = null;
    try {
      const blob = new Blob([buffer], { type: 'image/jpeg' });
      bitmap = await createImageBitmap(blob);

      // Reconfigure if first frame reveals different dimensions
      if (this.frameCount === 0 &&
         (bitmap.width !== this._width || bitmap.height !== this._height)) {
        console.log(`[WebCodecsPlayer] Adjusting dimensions: ${this._width}x${this._height} → ${bitmap.width}x${bitmap.height}`);
        this._width = bitmap.width;
        this._height = bitmap.height;
        this.encoder.configure({
          codec: 'avc1.42001F',
          width: this._width,
          height: this._height,
          bitrate: this.bitrate,
          framerate: this.framerate,
          latencyMode: 'realtime',
          avc: { format: 'avc' }
        });
      }

      const ts = timestamp ?? Math.round((performance.now() - this.startedAt) * 1000);
      frame = new VideoFrame(bitmap, {
        timestamp: ts,
        duration: Math.round(1_000_000 / this.framerate)
      });

      const isKeyFrame = this.frameCount % this.gopInterval === 0;
      this.encoder.encode(frame, { keyFrame: isKeyFrame });

      this.frameCount++;
      const now = performance.now();
      if (now - this.lastFpsUpdate >= 1000) {
        this.onFps(this.frameCount);
        this.frameCount = 0;
        this.lastFpsUpdate = now;
      }
    } catch (e) {
      this.onError(e);
    } finally {
      if (frame) try { frame.close(); } catch (_) {}
      if (bitmap) try { bitmap.close(); } catch (_) {}
    }
  }

  /**
   * Resize the encoder (e.g., if camera resolution changes).
   */
  resize(width, height) {
    if (this.encoder && width && height &&
       (width !== this._width || height !== this._height)) {
      this._width = width;
      this._height = height;
      // Reuse the codec selected during start by re-encoding a configuration
      // We don't store the codec info, so fall back to default H.264
      try {
        this.encoder.configure({
          codec: 'avc1.42001F',
          width, height,
          bitrate: this.bitrate,
          framerate: this.framerate,
          latencyMode: 'realtime',
          avc: { format: 'avc' }
        });
      } catch (e) {
        this.onError(e);
      }
    }
  }

  stop() {
    this.onState('stopped');
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    if (this.encoder) {
      try { this.encoder.close(); } catch (_) {}
      this.encoder = null;
    }
    if (this.mediaSource) {
      try {
        if (this.mediaSource.readyState === 'open') {
          this.mediaSource.endOfStream();
        }
      } catch (_) {}
      this.mediaSource = null;
    }
    if (this.videoEl && this._objectUrl) {
      try { URL.revokeObjectURL(this._objectUrl); } catch (_) {}
      this._objectUrl = null;
      this.videoEl.src = '';
      this.videoEl.removeAttribute('src');
    }
    this.sourceBuffer = null;
    this.muxer = null;
    this.isOpen = false;
  }

  getStats() {
    return {
      fps: 0,
      width: this._width,
      height: this._height,
      encodeQueueSize: this.encoder?.encodeQueueSize ?? 0,
      isOpen: this.isOpen
    };
  }
}

/**
 * React hook-style helper: subscribes to a server live-frame stream
 * and feeds the JPEGs into a WebCodecsPlayer instance.
 *
 * Server-side: the liveStreamer emits `live-frame-{cameraId}` with binary JPEG.
 * We just need to listen and feed to the player.
 */
export function attachLiveFrameSource(socket, cameraId, player) {
  const eventName = `live-frame-${cameraId}`;
  const onFrame = (jpegBuffer) => {
    if (jpegBuffer && jpegBuffer.byteLength > 0) {
      player.addFrame(jpegBuffer);
    }
  };
  socket.on(eventName, onFrame);
  return () => {
    socket.off(eventName, onFrame);
  };
}
