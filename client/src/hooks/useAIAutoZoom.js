import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useAIAutoZoom — Smoothly tracks the primary subject (person/face)
 * with the camera zoom by adjusting pan based on detection bounding boxes.
 *
 * - Smooths pan movement (lerp) so it doesn't jitter
 * - Re-centers on subject if it leaves the frame
 * - Returns a transform update callback that the stage should call on every frame
 */
export function useAIAutoZoom({ containerRef, videoRef, enabled, smoothing = 0.12 }) {
  const [targetPan, setTargetPan] = useState({ x: 0, y: 0 });
  const [trackingActive, setTrackingActive] = useState(false);
  const [trackedLabel, setTrackedLabel] = useState(null);
  const currentRef = useRef({ x: 0, y: 0 });
  const lostFrames = useRef(0);

  // Subscribe to AI detection events (from useWebSocket detections)
  const onDetections = useCallback((detections) => {
    if (!enabled) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // Pick the most "interesting" subject:
    // 1. If there's a person or any person with high confidence
    // 2. If weapon/threat, prefer it
    const threats = detections.filter(d => ['weapon', 'gun', 'knife', 'fight'].includes(d.label?.toLowerCase()));
    let target = threats[0];
    if (!target) {
      const persons = detections.filter(d => d.label === 'person');
      // Pick the largest person (closest)
      if (persons.length > 0) {
        target = persons.reduce((biggest, p) => {
          const area = p.width * p.height;
          return !biggest || area > biggest.width * biggest.height ? p : biggest;
        }, null);
      }
    }
    if (!target) {
      lostFrames.current++;
      if (lostFrames.current > 30) {
        setTrackingActive(false);
        setTrackedLabel(null);
      }
      return;
    }
    lostFrames.current = 0;
    setTrackingActive(true);
    setTrackedLabel(target.label || 'subject');

    // Compute target pan: subject's center should be at viewport center
    // Pan values needed to bring subject to center
    const subjectCenterX = (target.x + target.width / 2) - 0.5; // -0.5 to 0.5
    const subjectCenterY = (target.y + target.height / 2) - 0.5;
    const panX = -subjectCenterX * rect.width;
    const panY = -subjectCenterY * rect.height;
    setTargetPan({ x: panX, y: panY });
  }, [enabled, containerRef]);

  // Smoothly interpolate pan
  useEffect(() => {
    if (!enabled) return;
    let raf;
    const tick = () => {
      currentRef.current.x += (targetPan.x - currentRef.current.x) * smoothing;
      currentRef.current.y += (targetPan.y - currentRef.current.y) * smoothing;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, targetPan, smoothing]);

  // Get current smoothed pan (call this in render)
  const getCurrentPan = useCallback(() => ({
    x: Math.round(currentRef.current.x),
    y: Math.round(currentRef.current.y)
  }), []);

  return { onDetections, trackingActive, trackedLabel, getCurrentPan };
}

/**
 * useRecentPhotos — Loads photos from /api/photos and exposes a refreshable list
 */
export function useRecentPhotos(apiBase) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const res = await fetch(`${apiBase}/api/photos`, { credentials: 'include', headers });
      if (res.ok) {
        const data = await res.json();
        setPhotos(data.photos || []);
      }
    } catch (e) {
      console.warn('Failed to load photos:', e);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { refresh(); }, [refresh]);

  return { photos, loading, refresh, setPhotos };
}
