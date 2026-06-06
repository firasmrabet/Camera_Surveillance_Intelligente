import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ZoomInIcon, ZoomOutIcon, ResetIcon, RotateLeftIcon, RotateRightIcon,
  FlipHorizontalIcon, FlipVerticalIcon, AspectRatioIcon,
  FilterIcon, PlayIcon, PauseIcon, StepBackIcon, StepForwardIcon,
  CaptureIcon, GalleryIcon, FullscreenIcon, LockIcon, UnlockIcon,
  AIZoomIcon, KeyboardIcon
} from '../icons';

/**
 * FloatingToolbar — Bottom-center glassmorphism toolbar with all live view controls.
 * Auto-hides after 3s of inactivity, reappears on mouse movement.
 */
export default function FloatingToolbar({
  zoom, rotation, flipH, flipV, aspect, isLocked, isPlaying,
  isModified, activePreset,
  onZoomIn, onZoomOut, onRotateLeft, onRotateRight, onFlipH, onFlipV, onAspect,
  onReset, onLock,
  onPlayPause, onStepBack, onStepForward,
  onOpenFilters, onCapture, onOpenGallery, onToggleFullscreen, onToggleAI,
  onShowKeyboard,
  aiEnabled = false,
  // Filter panel open state to highlight filter button
  filtersOpen = false
}) {
  const [visible, setVisible] = useState(true);
  const [idleTimer, setIdleTimer] = useState(null);

  // Show on mount, hide after 3s of no mouse activity
  useEffect(() => {
    const show = () => {
      setVisible(true);
      if (idleTimer) clearTimeout(idleTimer);
      const t = setTimeout(() => setVisible(false), 3000);
      setIdleTimer(t);
    };
    show();
    window.addEventListener('mousemove', show);
    return () => {
      window.removeEventListener('mousemove', show);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, []);

  const Group = ({ children }) => (
    <div className="flex items-center gap-0.5 px-1.5 border-r border-slate-700/50 last:border-r-0">
      {children}
    </div>
  );

  const Btn = ({ onClick, active = false, disabled = false, children, title, badge }) => (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.12 }}
      whileTap={{ scale: disabled ? 1 : 0.92 }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`relative p-2.5 rounded-lg transition-all ${
        active
          ? 'bg-indigo-500/30 text-indigo-200 ring-1 ring-indigo-400/50'
          : disabled
            ? 'text-slate-600 cursor-not-allowed'
            : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
      }`}
    >
      {children}
      {badge && (
        <span className="absolute -top-1 -right-1 px-1 text-[9px] font-bold bg-amber-500 text-white rounded">
          {badge}
        </span>
      )}
    </motion.button>
  );

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 80, opacity: 0, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30"
        >
          <div className="glass-strong rounded-2xl shadow-2xl shadow-black/50 px-2 py-1.5 flex items-center gap-0.5 backdrop-blur-xl border border-slate-700/60">
            {/* ZOOM */}
            <Group>
              <Btn onClick={onZoomOut} title="Zoom out (-)">
                <ZoomOutIcon size={18} />
              </Btn>
              <div className="px-2 text-xs font-mono font-bold text-amber-300 min-w-[44px] text-center">
                {zoom.toFixed(1)}×
              </div>
              <Btn onClick={onZoomIn} title="Zoom in (+)">
                <ZoomInIcon size={18} />
              </Btn>
              <Btn onClick={onReset} title="Reset view (0)">
                <ResetIcon size={16} />
              </Btn>
            </Group>

            {/* ROTATE / FLIP */}
            <Group>
              <Btn onClick={onRotateLeft} title="Rotate left (L)">
                <RotateLeftIcon size={18} />
              </Btn>
              <Btn onClick={onRotateRight} title="Rotate right (R)">
                <RotateRightIcon size={18} />
              </Btn>
              <Btn onClick={onFlipH} active={flipH} title="Flip horizontal (H)">
                <FlipHorizontalIcon size={18} />
              </Btn>
              <Btn onClick={onFlipV} active={flipV} title="Flip vertical (V)">
                <FlipVerticalIcon size={18} />
              </Btn>
              <Btn onClick={onAspect} title={`Aspect: ${aspect} (A)`}>
                <AspectRatioIcon size={18} />
              </Btn>
            </Group>

            {/* PLAYBACK */}
            <Group>
              <Btn onClick={onStepBack} title="Step back (←)">
                <StepBackIcon size={18} />
              </Btn>
              <Btn onClick={onPlayPause} active={!isPlaying} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}>
                {isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
              </Btn>
              <Btn onClick={onStepForward} title="Step forward (→)">
                <StepForwardIcon size={18} />
              </Btn>
            </Group>

            {/* FILTERS */}
            <Group>
              <Btn onClick={onOpenFilters} active={filtersOpen} title="Image filters" badge={isModified ? '!' : null}>
                <FilterIcon size={18} />
              </Btn>
            </Group>

            {/* CAPTURE */}
            <Group>
              <Btn onClick={onCapture} title="Capture photo (P)">
                <CaptureIcon size={18} />
              </Btn>
              <Btn onClick={onOpenGallery} title="Open photo gallery">
                <GalleryIcon size={18} />
              </Btn>
            </Group>

            {/* AI / FULLSCREEN / LOCK */}
            <Group>
              <Btn onClick={onToggleAI} active={aiEnabled} title="AI smart auto-zoom">
                <AIZoomIcon size={18} />
              </Btn>
              <Btn onClick={onShowKeyboard} title="Keyboard shortcuts (?)">
                <KeyboardIcon size={18} />
              </Btn>
              <Btn onClick={onLock} active={isLocked} title="Lock view">
                {isLocked ? <LockIcon size={18} /> : <UnlockIcon size={18} />}
              </Btn>
              <Btn onClick={onToggleFullscreen} title="Fullscreen (F)">
                <FullscreenIcon size={18} />
              </Btn>
            </Group>
          </div>

          {/* Active preset indicator */}
          {activePreset && activePreset !== 'default' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[10px] font-bold rounded-full bg-indigo-500/80 text-white"
            >
              {activePreset.toUpperCase()} MODE
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
