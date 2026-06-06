import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * PhotoCapture — Handles snapping photos from a video element.
 *
 * Renders a flash overlay + brief shutter animation when capturePhoto() is called.
 * Captures from the actual `<video>` element so we get raw pixels at full quality.
 */
export function usePhotoCapture(mediaRef, options = {}) {
  const [flash, setFlash] = useState(false);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const lastError = useRef(null);

  const capturePhoto = async (captureOpts = {}) => {
    if (busy) return null;
    const media = mediaRef?.current;

    setBusy(true);
    try {
      if (captureOpts.preferServer && captureOpts.apiBase && captureOpts.cameraId) {
        const res = await fetch(`${captureOpts.apiBase}/api/cameras/${captureOpts.cameraId}/capture-fresh?token=${encodeURIComponent(captureOpts.token || '')}&t=${Date.now()}`);
        if (!res.ok) throw new Error(`Server capture failed: ${res.statusText}`);
        const blob = await res.blob();
        
        setFlash(true);
        setTimeout(() => setFlash(false), 220);
        setCount(c => c + 1);
        
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        
        const img = new Image();
        img.src = dataUrl;
        await new Promise(r => { img.onload = r; img.onerror = r; });
        
        return {
          blob,
          dataUrl,
          width: img.width || 1280,
          height: img.height || 720,
          timestamp: Date.now(),
          source: 'server'
        };
      }

      if (!media) {
        lastError.current = 'No media element';
        return null;
      }
      // Determine dimensions from video or image
      let width = 0, height = 0;
      const tag = media.tagName?.toLowerCase();
      if (tag === 'video') {
        if (!media.videoWidth || !media.videoHeight) { lastError.current = 'No video loaded'; return null; }
        width = media.videoWidth; height = media.videoHeight;
      } else if (tag === 'img') {
        if (!media.naturalWidth || !media.naturalHeight) { lastError.current = 'No image loaded'; return null; }
        width = media.naturalWidth; height = media.naturalHeight;
      } else if (tag === 'canvas') {
        if (!media.width || !media.height) { lastError.current = 'No canvas content'; return null; }
        width = media.width; height = media.height;
      } else {
        lastError.current = 'Unsupported media element';
        return null;
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      // draw from video or image element
      ctx.drawImage(media, 0, 0, canvas.width, canvas.height);
      // Properly handle blob creation with error handling
      const blob = await new Promise((resolve, reject) => {
        try {
          canvas.toBlob(
            (b) => b ? resolve(b) : reject(new Error('Canvas blob creation failed')),
            'image/jpeg',
            0.92
          );
        } catch (e) {
          reject(e);
        }
      });
      // Flash effect
      setFlash(true);
      setTimeout(() => setFlash(false), 220);
      setCount(c => c + 1);
      return {
        blob,
        dataUrl: canvas.toDataURL('image/jpeg', 0.92),
        width: canvas.width,
        height: canvas.height,
        timestamp: Date.now(),
        source: 'local'
      };
    } catch (err) {
      lastError.current = err.message;
      return null;
    } finally {
      setBusy(false);
    }
  };

  return { capturePhoto, flash, count, busy, lastError: lastError.current };
}

/**
 * FlashOverlay — Renders the white flash + shutter animation
 */
export function FlashOverlay({ show }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.85 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="absolute inset-0 z-50 bg-white pointer-events-none"
        />
      )}
    </AnimatePresence>
  );
}

/**
 * ShutterFrame — Quick bracket that appears around the video during capture
 */
export function ShutterFrame({ show }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, scale: 1.2 }}
          animate={{ opacity: [0, 1, 1, 0], scale: [1.2, 1, 1, 0.95] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="absolute inset-4 z-40 pointer-events-none border-2 border-amber-400 rounded-lg"
          style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)' }}
        />
      )}
    </AnimatePresence>
  );
}

/**
 * PhotoCounter — Small badge in corner with captured count
 */
export function PhotoCounter({ count, onOpenGallery }) {
  if (count === 0) return null;
  return (
    <motion.button
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      onClick={onOpenGallery}
      className="absolute top-3 left-3 z-30 px-2 py-1 rounded-full bg-amber-500/90 text-white text-[11px] font-bold flex items-center gap-1.5 shadow-lg"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
      {count} photo{count > 1 ? 's' : ''}
    </motion.button>
  );
}
