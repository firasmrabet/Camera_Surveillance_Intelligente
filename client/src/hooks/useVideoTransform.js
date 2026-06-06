import { useState, useCallback, useEffect, useRef } from 'react';

const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
const ZOOM_STEP = 0.1;

/**
 * useVideoTransform — Manages zoom, pan, rotation, flip and aspect ratio
 * of a video element, with mouse wheel zoom, drag pan, and keyboard shortcuts.
 */
export function useVideoTransform({ enableKeyboard = true } = {}) {
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [aspect, setAspect] = useState('contain'); // contain | cover | fill | fit
  const [isLocked, setIsLocked] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef(null);
  const dragRef = useRef({ startX: 0, startY: 0, origX: 0, origY: 0 });
  // Refs for wheel handler (avoids stale closure + allows non-passive listener)
  const zoomRef = useRef(1);
  const setZoomAtRef = useRef(() => {});
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // ============ ZOOM ============
  const zoomIn = useCallback(() => {
    setZoom(z => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom(z => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)));
    setPanX(0);
    setPanY(0);
  }, []);

  const setZoomAt = useCallback((newZoom, centerX, centerY) => {
    setZoom(prev => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      // Adjust pan to keep the point under the cursor fixed
      if (centerX !== undefined && centerY !== undefined && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const cx = centerX - rect.left - rect.width / 2;
        const cy = centerY - rect.top - rect.height / 2;
        const ratio = clamped / prev;
        setPanX(p => -cx * (ratio - 1) + p * ratio);
        setPanY(p => -cy * (ratio - 1) + p * ratio);
      }
      return clamped;
    });
  }, []);

  // Keep ref in sync for use inside non-passive event listener
  useEffect(() => { setZoomAtRef.current = setZoomAt; }, [setZoomAt]);

  // ============ PAN ============
  const startDrag = useCallback((e) => {
    if (isLocked) return;
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: panX,
      origY: panY
    };
    e.preventDefault();
  }, [panX, panY, isLocked]);

  const onDrag = useCallback((e) => {
    if (!isDragging || isLocked) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPanX(dragRef.current.origX + dx);
    setPanY(dragRef.current.origY + dy);
  }, [isDragging, isLocked]);

  const endDrag = useCallback(() => {
    setIsDragging(false);
  }, []);

  // ============ WHEEL ZOOM (centered on cursor) ============
  // Note: React's onWheel is passive by default (React 17+), so we attach a
  // non-passive listener directly to the container to allow preventDefault().
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e) => {
      if (isLocked) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP * 2 : ZOOM_STEP * 2;
      setZoomAtRef.current(zoomRef.current + delta, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [isLocked]);

  // ============ ROTATION ============
  const rotate = useCallback((degrees = 90) => {
    setRotation(r => (r + degrees) % 360);
  }, []);

  const rotateLeft = useCallback(() => rotate(-90), [rotate]);
  const rotateRight = useCallback(() => rotate(90), [rotate]);

  // ============ FLIP ============
  const toggleFlipH = useCallback(() => setFlipH(f => !f), []);
  const toggleFlipV = useCallback(() => setFlipV(f => !f), []);

  // ============ ASPECT ============
  const cycleAspect = useCallback(() => {
    setAspect(a => {
      const order = ['contain', 'cover', 'fill', 'fit'];
      const idx = order.indexOf(a);
      return order[(idx + 1) % order.length];
    });
  }, []);

  // ============ RESET ============
  const reset = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setAspect('contain');
  }, []);

  // ============ LOCK ============
  const toggleLock = useCallback(() => setIsLocked(l => !l), []);

  // ============ FULLSCREEN ============
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);

  // ============ KEYBOARD ============
  useEffect(() => {
    if (!enableKeyboard) return;
    const handler = (e) => {
      // Don't trigger when typing in inputs
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      switch (e.key) {
        case '+': case '=': e.preventDefault(); zoomIn(); break;
        case '-': case '_': e.preventDefault(); zoomOut(); break;
        case '0': e.preventDefault(); reset(); break;
        case 'r': case 'R': e.preventDefault(); rotateRight(); break;
        case 'l': case 'L': e.preventDefault(); rotateLeft(); break;
        case 'h': case 'H': e.preventDefault(); toggleFlipH(); break;
        case 'v': case 'V': e.preventDefault(); toggleFlipV(); break;
        case 'a': case 'A': e.preventDefault(); cycleAspect(); break;
        case 'f': case 'F': e.preventDefault(); toggleFullscreen(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enableKeyboard, zoomIn, zoomOut, reset, rotateRight, rotateLeft, toggleFlipH, toggleFlipV, cycleAspect, toggleFullscreen]);

  // Listen for fullscreen changes (e.g. user presses Esc)
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // ============ TRANSFORM STRING ============
  const transform = `translate(${panX}px, ${panY}px) scale(${zoom * (flipH ? -1 : 1)}, ${zoom * (flipV ? -1 : 1)}) rotate(${rotation}deg)`;

  // ============ ASPECT OBJECT-FIT ============
  const objectFit = aspect === 'fill' ? 'fill' : aspect === 'cover' ? 'cover' : 'contain';

  return {
    // State
    zoom, panX, panY, rotation, flipH, flipV, aspect, isLocked, isDragging, isFullscreen,
    // Refs
    containerRef,
    // Actions
    zoomIn, zoomOut, setZoomAt, setZoom, setPanX, setPanY,
    rotate, rotateLeft, rotateRight,
    toggleFlipH, toggleFlipV,
    cycleAspect, setAspect,
    reset, toggleLock, toggleFullscreen,
    // Handlers
    startDrag, onDrag, endDrag,
    // Computed
    transform, objectFit
  };
}

export default useVideoTransform;
