/**
 * Custom hand-drawn SVG icon library for the live view controls.
 * Each icon is a self-contained React component that:
 *  - Uses currentColor for stroke/fill
 *  - Has a 24x24 viewBox
 *  - Uses 1.5px stroke width (rounded caps)
 *  - Supports className and style props
 *
 * NOT lucide-react — these are hand-crafted for the surveillance feel.
 */
import React from 'react';

const baseProps = (size, className, style) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className,
  style
});

const I = ({ size = 20, className = '', style = {}, children, viewBox = '0 0 24 24' }) => (
  <svg {...baseProps(size, className, style)} viewBox={viewBox}>
    {children}
  </svg>
);

// === ZOOM ===
export const ZoomInIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <circle cx="11" cy="11" r="7" />
    <path d="M11 8v6M8 11h6" />
    <path d="M20 20l-4-4" />
  </I>
);

export const ZoomOutIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <circle cx="11" cy="11" r="7" />
    <path d="M8 11h6" />
    <path d="M20 20l-4-4" />
  </I>
);

export const ResetIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </I>
);

// === TRANSFORM ===
export const RotateIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M3 12a9 9 0 1 0 3.5-7.1" />
    <path d="M3 4v5h5" />
  </I>
);

export const RotateLeftIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </I>
);

export const RotateRightIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 4v5h-5" />
  </I>
);

export const FlipHorizontalIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M12 3v18" strokeDasharray="2 2" />
    <path d="M3 8l4 4-4 4" />
    <path d="M21 8l-4 4 4 4" />
  </I>
);

export const FlipVerticalIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M3 12h18" strokeDasharray="2 2" />
    <path d="M8 3l4 4 4-4" />
    <path d="M8 21l4-4 4 4" />
  </I>
);

export const AspectRatioIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <rect x="3" y="5" width="18" height="14" rx="1" />
    <path d="M3 9h4M3 15h4M17 9h4M17 15h4" />
  </I>
);

// === FILTERS (image adjustments) ===
export const BrightnessIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </I>
);

export const ContrastIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor" stroke="none" />
  </I>
);

export const SaturationIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    <path d="M12 3a9 9 0 0 0 0 18z" />
  </I>
);

export const HueIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M12 3a9 9 0 1 0 9 9" />
    <path d="M12 3v18" />
    <circle cx="12" cy="3" r="1.5" fill="currentColor" />
    <circle cx="21" cy="12" r="1.5" fill="currentColor" />
    <circle cx="12" cy="21" r="1.5" fill="currentColor" />
    <circle cx="3" cy="12" r="1.5" fill="currentColor" />
  </I>
);

export const SharpenIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M12 3l2 7h7l-5.5 4 2 7L12 17l-5.5 4 2-7L3 10h7z" />
  </I>
);

export const BlurIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <circle cx="12" cy="12" r="3" />
    <circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="19" cy="6" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="19" cy="18" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="21" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </I>
);

export const InvertIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor" stroke="currentColor" />
  </I>
);

export const ExposureIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <circle cx="12" cy="12" r="4" />
    <path d="M5 12h-2M21 12h-2M12 5v-2M12 21v-2" />
    <circle cx="12" cy="12" r="9" />
  </I>
);

// === PLAYBACK ===
export const PlayIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M6 4l14 8-14 8z" fill="currentColor" />
  </I>
);

export const PauseIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <rect x="6" y="4" width="4" height="16" fill="currentColor" />
    <rect x="14" y="4" width="4" height="16" fill="currentColor" />
  </I>
);

export const StepBackIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M18 5l-9 7 9 7z" fill="currentColor" />
    <rect x="4" y="5" width="2" height="14" fill="currentColor" />
  </I>
);

export const StepForwardIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M6 5l9 7-9 7z" fill="currentColor" />
    <rect x="18" y="5" width="2" height="14" fill="currentColor" />
  </I>
);

export const SpeedIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 12l5-3" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </I>
);

// === CAPTURE & RECORD ===
export const CaptureIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M3 7h3l2-2h8l2 2h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="4" />
  </I>
);

export const RecordIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <circle cx="12" cy="12" r="6" fill="currentColor" />
  </I>
);

export const GalleryIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </I>
);

export const TrashIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14" />
    <path d="M10 11v6M14 11v6" />
  </I>
);

export const FullscreenIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M3 8V4a1 1 0 0 1 1-1h4M16 3h4a1 1 0 0 1 1 1v4M21 16v4a1 1 0 0 1-1 1h-4M8 21H4a1 1 0 0 1-1-1v-4" />
  </I>
);

export const LockIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <rect x="4" y="11" width="16" height="10" rx="1" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </I>
);

export const UnlockIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <rect x="4" y="11" width="16" height="10" rx="1" />
    <path d="M8 11V7a4 4 0 0 1 8 0" />
  </I>
);

export const PipIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <rect x="3" y="4" width="18" height="16" rx="1" />
    <rect x="13" y="13" width="6" height="5" rx="0.5" fill="currentColor" />
  </I>
);

export const FilterIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M3 4h18l-7 8v8l-4-2v-6z" />
  </I>
);

export const SparkleIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M12 3l1.5 5L19 9l-5.5 1L12 15l-1.5-5L5 9l5.5-1z" />
    <path d="M19 17l.5 1.5L21 19l-1.5.5L19 21l-.5-1.5L17 19l1.5-.5z" />
  </I>
);

export const CrosshairIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
  </I>
);

export const KeyboardIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <rect x="2" y="6" width="20" height="12" rx="1" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M10 14h.01M14 14h.01M18 14h.01M8 14h8" />
  </I>
);

export const LayersIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
    <path d="M3 17l9 5 9-5" />
  </I>
);

export const DownloadIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M3 17v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3" />
  </I>
);

export const EyeIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </I>
);

// === Smart Auto-Zoom AI ===
export const AIZoomIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <circle cx="11" cy="11" r="6" />
    <path d="M11 8v6M8 11h6" />
    <path d="M20 20l-4-4" />
    <path d="M19 3l1 1-1 1M22 6h-2" />
  </I>
);

// === Close (X) — Hand-drawn, scribbled feel ===
export const CloseIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </I>
);

// === Delete / Trash can — sketched style ===
export const DeleteIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
    <path d="M10 11v6M14 11v6" />
  </I>
);

// === Expand — fullscreen arrows ===
export const ExpandIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </I>
);

// === Share — three-dot network ===
export const ShareIcon = ({ size, className, style }) => (
  <I size={size} className={className} style={style}>
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M8 11l8-4M8 13l8 4" />
  </I>
);

export default {
  ZoomInIcon, ZoomOutIcon, ResetIcon,
  RotateIcon, RotateLeftIcon, RotateRightIcon,
  FlipHorizontalIcon, FlipVerticalIcon, AspectRatioIcon,
  BrightnessIcon, ContrastIcon, SaturationIcon, HueIcon, SharpenIcon, BlurIcon, InvertIcon, ExposureIcon,
  PlayIcon, PauseIcon, StepBackIcon, StepForwardIcon, SpeedIcon,
  CaptureIcon, RecordIcon, GalleryIcon, TrashIcon,
  FullscreenIcon, LockIcon, UnlockIcon, PipIcon,
  FilterIcon, SparkleIcon, CrosshairIcon, KeyboardIcon, LayersIcon, DownloadIcon, EyeIcon, AIZoomIcon,
  CloseIcon, DeleteIcon, ExpandIcon, ShareIcon
};
