import React, { forwardRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * VideoStage — The container that applies transform/filters to a video or image.
 * - Handles zoom/pan/rotate/flip via CSS transform on a child element
 * - Applies CSS filters + SVG sharpen overlay
 * - Pass-through children (video/img/canvas)
 */
const VideoStage = forwardRef(({
  transform,
  cssFilter,
  svgFilter,
  objectFit = 'contain',
  isDragging,
  isLocked,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  onWheel,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  children,
  showScanLine = true,
  showRadar = false
}, ref) => {
  return (
    <div
      ref={ref}
      className="absolute inset-0 overflow-hidden bg-black select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        cursor: isLocked ? 'not-allowed' : isDragging ? 'grabbing' : 'grab',
        touchAction: 'none'
      }}
    >
      {/* SVG filter defs for sharpen */}
      {svgFilter && (
        <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true">
          <defs>
            <filter id={svgFilter.id}>
              <feConvolveMatrix kernelMatrix={svgFilter.matrix} />
            </filter>
          </defs>
        </svg>
      )}

      {/* The transformable content */}
      <motion.div
        className="w-full h-full"
        style={{
          transform,
          transformOrigin: 'center center',
          transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          willChange: 'transform',
          filter: svgFilter ? `url(#${svgFilter.id})` : undefined
        }}
      >
        <div
          className="w-full h-full"
          style={{
            filter: svgFilter ? undefined : cssFilter
          }}
        >
          {children}
        </div>
      </motion.div>

      {/* Scan line overlay (always on for live feeds) */}
      {showScanLine && (
        <div className="scan-line opacity-40" />
      )}

      {/* Radar mini during AI active */}
      <AnimatePresence>
        {showRadar && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            className="absolute bottom-3 right-3 radar"
            style={{ width: 60, height: 60 }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-cyan-400" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

VideoStage.displayName = 'VideoStage';

export default VideoStage;
