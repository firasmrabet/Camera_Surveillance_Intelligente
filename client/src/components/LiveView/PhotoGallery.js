import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CloseIcon, DeleteIcon, DownloadIcon, ExpandIcon, ShareIcon } from '../icons';

/**
 * PhotoGallery — Modal grid view of captured photos with lightbox preview.
 *
 * Photos are passed in as an array of { id, url, thumbnailUrl, timestamp, cameraName, ... }
 * Lazy-loads thumbnails, supports delete + download.
 */
export default function PhotoGallery({ open, onClose, photos, onDelete, onDownload }) {
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [filter, setFilter] = useState('all'); // all | today | week

  useEffect(() => {
    if (!open) setLightboxIndex(null);
  }, [open]);

  // Keyboard nav for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowRight') setLightboxIndex(i => Math.min(photos.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setLightboxIndex(i => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIndex, photos]);

  const filtered = photos.filter(p => {
    if (filter === 'all') return true;
    const age = Date.now() - p.timestamp;
    if (filter === 'today') return age < 24 * 3600 * 1000;
    if (filter === 'week') return age < 7 * 24 * 3600 * 1000;
    return true;
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 250, damping: 25 }}
            className="glass-strong rounded-2xl shadow-2xl shadow-black/50 max-w-5xl w-full max-h-[90vh] flex flex-col border border-slate-700/60"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700/50">
              <div className="flex items-center gap-3">
                <h3 className="text-base font-bold text-slate-100">Photo Gallery</h3>
                <span className="text-xs text-slate-500">{filtered.length} / {photos.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <FilterTabs filter={filter} setFilter={setFilter} />
                <button
                  onClick={onClose}
                  className="p-1.5 rounded hover:bg-slate-700/60 text-slate-400 hover:text-white"
                  title="Close (Esc)"
                >
                  <CloseIcon size={18} />
                </button>
              </div>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto p-4">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                  <div className="text-4xl mb-2">📷</div>
                  <p className="text-sm">No photos captured yet</p>
                  <p className="text-xs text-slate-600 mt-1">Press the camera button or 'P' to capture</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {filtered.map((photo, i) => (
                    <motion.div
                      key={photo.id || i}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.02 }}
                      className="group relative aspect-video rounded-lg overflow-hidden border border-slate-700/50 hover:border-indigo-400 cursor-pointer bg-black"
                      onClick={() => setLightboxIndex(i)}
                    >
                      <img
                        src={photo.thumbnailUrl || photo.url}
                        alt={photo.cameraName}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="absolute bottom-1 left-1.5 right-1.5 text-[10px] text-white truncate">
                          {new Date(photo.timestamp).toLocaleString()}
                        </div>
                        <div className="absolute top-1 right-1 flex gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); onDownload?.(photo); }}
                            className="p-1 rounded bg-slate-800/80 hover:bg-indigo-500/80 text-white"
                            title="Download"
                          >
                            <DownloadIcon size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onDelete?.(photo); }}
                            className="p-1 rounded bg-slate-800/80 hover:bg-rose-500/80 text-white"
                            title="Delete"
                          >
                            <DeleteIcon size={12} />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>

          {/* Lightbox */}
          <AnimatePresence>
            {lightboxIndex !== null && filtered[lightboxIndex] && (
              <Lightbox
                photo={filtered[lightboxIndex]}
                onClose={() => setLightboxIndex(null)}
                onPrev={() => setLightboxIndex(i => Math.max(0, i - 1))}
                onNext={() => setLightboxIndex(i => Math.min(filtered.length - 1, i + 1))}
                onDownload={() => onDownload?.(filtered[lightboxIndex])}
                onDelete={() => {
                  if (window.confirm('Delete this photo?')) {
                    onDelete?.(filtered[lightboxIndex]);
                    setLightboxIndex(i => i >= filtered.length - 1 ? null : i);
                  }
                }}
                hasPrev={lightboxIndex > 0}
                hasNext={lightboxIndex < filtered.length - 1}
              />
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FilterTabs({ filter, setFilter }) {
  const tabs = [
    { id: 'all', label: 'All' },
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This week' }
  ];
  return (
    <div className="flex gap-1 p-0.5 rounded-lg bg-slate-800/50">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => setFilter(t.id)}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            filter === t.id
              ? 'bg-indigo-500/80 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Lightbox({ photo, onClose, onPrev, onNext, onDownload, onDelete, hasPrev, hasNext }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 bg-black/95 flex items-center justify-center p-8"
      onClick={onClose}
    >
      <img
        src={photo.url}
        alt="full"
        className="max-w-full max-h-full object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="absolute top-4 right-4 flex gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onDownload(); }}
          className="p-2 rounded-lg bg-slate-800/80 hover:bg-indigo-500/80 text-white"
          title="Download"
        >
          <DownloadIcon size={18} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-2 rounded-lg bg-slate-800/80 hover:bg-rose-500/80 text-white"
          title="Delete"
        >
          <DeleteIcon size={18} />
        </button>
        <button
          onClick={onClose}
          className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-white"
          title="Close"
        >
          <CloseIcon size={18} />
        </button>
      </div>
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-slate-800/80 hover:bg-indigo-500/80 text-white text-2xl"
        >
          ‹
        </button>
      )}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-slate-800/80 hover:bg-indigo-500/80 text-white text-2xl"
        >
          ›
        </button>
      )}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-slate-300 bg-slate-900/80 px-3 py-1.5 rounded-full">
        {new Date(photo.timestamp).toLocaleString()} • {photo.cameraName}
      </div>
    </motion.div>
  );
}
