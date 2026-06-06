import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PRESETS } from '../../hooks/useVideoFilters';
import { CloseIcon, ResetIcon } from '../icons';

const SLIDERS = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 2, step: 0.05, format: v => `${(v * 100).toFixed(0)}%` },
  { key: 'exposure', label: 'Exposure', min: -1, max: 1, step: 0.05, format: v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%` },
  { key: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.05, format: v => `${(v * 100).toFixed(0)}%` },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.05, format: v => `${(v * 100).toFixed(0)}%` },
  { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, format: v => `${v}°` },
  { key: 'blur', label: 'Blur', min: 0, max: 10, step: 0.1, format: v => `${v.toFixed(1)}px` },
  { key: 'sepia', label: 'Sepia', min: 0, max: 100, step: 1, format: v => `${v}%` },
  { key: 'grayscale', label: 'Grayscale', min: 0, max: 100, step: 1, format: v => `${v}%` },
  { key: 'invert', label: 'Invert', min: 0, max: 100, step: 1, format: v => `${v}%` },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 100, step: 1, format: v => v === 0 ? 'Off' : `${v.toFixed(0)}%` }
];

/**
 * FilterPanel — Slide-out panel from right with sliders + preset chips.
 * Brightness/contrast/saturation dominate the top, advanced options collapse.
 */
export default function FilterPanel({ open, onClose, filters, setFilter, applyPreset, activePreset, reset, isModified }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const basicKeys = ['brightness', 'exposure', 'contrast', 'saturation'];
  const advancedKeys = ['hue', 'blur', 'sepia', 'grayscale', 'invert', 'sharpen'];

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />
          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 280, damping: 30 }}
            className="absolute right-0 top-0 bottom-0 z-50 w-80 glass-strong border-l border-slate-700/60 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700/50">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                Image Filters
                {isModified && <span className="text-[10px] text-amber-400">• MODIFIED</span>}
              </h3>
              <div className="flex gap-1">
                <button
                  onClick={reset}
                  title="Reset filters"
                  className="p-1.5 rounded hover:bg-slate-700/60 text-slate-400 hover:text-white"
                >
                  <ResetIcon size={14} />
                </button>
                <button
                  onClick={onClose}
                  title="Close (Esc)"
                  className="p-1.5 rounded hover:bg-slate-700/60 text-slate-400 hover:text-white"
                >
                  <CloseIcon size={16} />
                </button>
              </div>
            </div>

            {/* PRESETS */}
            <div className="p-4 border-b border-slate-700/50">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Presets</div>
              <div className="grid grid-cols-3 gap-1.5">
                {Object.entries(PRESETS).map(([id, p]) => (
                  <motion.button
                    key={id}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => applyPreset(id)}
                    className={`p-2 rounded-lg text-xs font-medium border transition-all ${
                      activePreset === id
                        ? 'bg-indigo-500/30 border-indigo-400 text-indigo-100'
                        : 'bg-slate-800/40 border-slate-700 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    <div className="text-lg mb-0.5">{p.icon}</div>
                    {p.name}
                  </motion.button>
                ))}
              </div>
            </div>

            {/* BASIC SLIDERS */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <SliderRow keys={basicKeys} filters={filters} setFilter={setFilter} />
              <button
                onClick={() => setShowAdvanced(s => !s)}
                className="w-full text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300 py-1.5"
              >
                {showAdvanced ? '▼ Hide' : '▶ Show'} advanced (hue, blur, sepia…)
              </button>
              {showAdvanced && <SliderRow keys={advancedKeys} filters={filters} setFilter={setFilter} />}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function SliderRow({ keys, filters, setFilter }) {
  return (
    <>
      {SLIDERS.filter(s => keys.includes(s.key)).map(s => (
        <div key={s.key} className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-300 font-medium">{s.label}</span>
            <span className="text-slate-500 font-mono">{s.format(filters[s.key])}</span>
          </div>
          <input
            type="range"
            min={s.min}
            max={s.max}
            step={s.step}
            value={filters[s.key]}
            onChange={(e) => setFilter(s.key, parseFloat(e.target.value))}
            className="w-full filter-slider"
          />
        </div>
      ))}
    </>
  );
}
