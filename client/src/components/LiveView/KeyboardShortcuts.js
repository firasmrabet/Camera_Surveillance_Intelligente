import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CloseIcon, KeyboardIcon } from '../icons';

const SHORTCUTS = [
  { keys: ['+', '='], action: 'Zoom in' },
  { keys: ['-', '_'], action: 'Zoom out' },
  { keys: ['0'], action: 'Reset view' },
  { keys: ['R'], action: 'Rotate right' },
  { keys: ['L'], action: 'Rotate left' },
  { keys: ['H'], action: 'Flip horizontal' },
  { keys: ['V'], action: 'Flip vertical' },
  { keys: ['A'], action: 'Cycle aspect ratio' },
  { keys: ['F'], action: 'Toggle fullscreen' },
  { keys: ['Space'], action: 'Play / Pause' },
  { keys: ['←', '→'], action: 'Step back / forward' },
  { keys: ['P'], action: 'Capture photo' },
  { keys: ['G'], action: 'Open gallery' },
  { keys: ['I'], action: 'Toggle filter panel' },
  { keys: ['Z'], action: 'Toggle AI auto-zoom' },
  { keys: ['K'], action: 'Lock / Unlock view' },
  { keys: ['?'], action: 'Show this help' },
  { keys: ['Esc'], action: 'Close panel / modal' },
  { keys: ['Mouse wheel'], action: 'Zoom at cursor' },
  { keys: ['Click + drag'], action: 'Pan view' }
];

export default function KeyboardShortcuts({ open, onClose }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-strong rounded-2xl shadow-2xl shadow-black/50 max-w-md w-full p-5 border border-slate-700/60"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <KeyboardIcon size={20} />
                Keyboard Shortcuts
              </h3>
              <button
                onClick={onClose}
                className="p-1.5 rounded hover:bg-slate-700/60 text-slate-400 hover:text-white"
              >
                <CloseIcon size={18} />
              </button>
            </div>
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {SHORTCUTS.map(s => (
                <div key={s.action} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-800/40">
                  <div className="flex gap-1">
                    {s.keys.map(k => (
                      <kbd
                        key={k}
                        className="px-2 py-0.5 text-[11px] font-mono font-bold rounded bg-slate-700/60 text-slate-200 border border-slate-600/50 shadow-sm min-w-[24px] text-center"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                  <span className="text-xs text-slate-300">{s.action}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-3 text-center">
              Shortcuts are disabled when typing in inputs
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
