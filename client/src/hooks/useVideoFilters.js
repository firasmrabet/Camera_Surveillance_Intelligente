import { useState, useCallback, useEffect } from 'react';

export const DEFAULT_FILTERS = {
  brightness: 1.0,
  contrast: 1.0,
  saturation: 1.0,
  hue: 0,
  blur: 0,
  sepia: 0,
  grayscale: 0,
  invert: 0,
  exposure: 0,
  sharpen: 0
};

export const PRESETS = {
  default: { name: 'Default', icon: '⚡', filters: { ...DEFAULT_FILTERS } },
  day: {
    name: 'Day',
    icon: '☀',
    filters: { ...DEFAULT_FILTERS, brightness: 1.05, contrast: 1.1, saturation: 1.1 }
  },
  night: {
    name: 'Night',
    icon: '🌙',
    filters: { ...DEFAULT_FILTERS, brightness: 1.5, contrast: 1.3, saturation: 1.2, exposure: 0.3 }
  },
  rain: {
    name: 'Rain',
    icon: '🌧',
    filters: { ...DEFAULT_FILTERS, contrast: 1.25, saturation: 0.85, sharpen: 40, blur: 0.5 }
  },
  fog: {
    name: 'Fog',
    icon: '🌫',
    filters: { ...DEFAULT_FILTERS, contrast: 1.4, saturation: 0.6, hue: 8, brightness: 1.15 }
  },
  forensic: {
    name: 'Forensic',
    icon: '🔍',
    filters: { ...DEFAULT_FILTERS, grayscale: 100, contrast: 1.5, brightness: 1.2, sharpen: 60 }
  }
};

/**
 * useVideoFilters — Manages image filter state, presets, and builds
 * a CSS filter string + a SVG feConvolveMatrix for sharpness.
 */
export function useVideoFilters() {
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [activePreset, setActivePreset] = useState('default');

  const setFilter = useCallback((key, value) => {
    setFilters(prev => {
      const next = { ...prev, [key]: value };
      // Detect if still matches a preset
      const matched = Object.entries(PRESETS).find(([id, p]) =>
        Object.keys(DEFAULT_FILTERS).every(k => Math.abs(p.filters[k] - next[k]) < 0.01)
      );
      setActivePreset(matched ? matched[0] : 'custom');
      return next;
    });
  }, []);

  const applyPreset = useCallback((presetId) => {
    const preset = PRESETS[presetId];
    if (!preset) return;
    setFilters({ ...preset.filters });
    setActivePreset(presetId);
  }, []);

  const reset = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    setActivePreset('default');
  }, []);

  // Build CSS filter string (sharpen is applied via SVG overlay, not CSS)
  const cssFilter = [
    `brightness(${filters.brightness + filters.exposure})`,
    `contrast(${filters.contrast})`,
    `saturate(${filters.saturation})`,
    `hue-rotate(${filters.hue}deg)`,
    `blur(${filters.blur}px)`,
    `sepia(${filters.sepia}%)`,
    `grayscale(${filters.grayscale}%)`,
    `invert(${filters.invert}%)`
  ].join(' ');

  // Build SVG filter for sharpening (feConvolveMatrix)
  const svgFilter = filters.sharpen > 0 ? buildSharpenSvg(filters.sharpen) : null;

  // Mark if any filter is non-default
  const isModified = activePreset === 'custom';

  return {
    filters,
    setFilter,
    applyPreset,
    reset,
    activePreset,
    isModified,
    cssFilter,
    svgFilter
  };
}

function buildSharpenSvg(amount) {
  // Amount 0-100 → matrix strength
  const k = amount / 100; // 0-1
  // Standard sharpen kernel: center = 1 + 4k, neighbors = -k
  const c = 1 + 4 * k;
  const n = -k;
  return {
    id: 'sharpen',
    matrix: `${n} 0 0 0 0  0 ${n} 0 0 0  0 0 ${c} 0 0  0 0 0 1 0`
  };
}

export default useVideoFilters;
