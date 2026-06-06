const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { authenticate } = require('./auth');
const db = require('../utils/database');
const { logger } = require('../utils/logger');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads/photos');
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

// Ensure upload root exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(UPLOAD_ROOT);

/**
 * POST /api/photos
 * Body: { cameraId, cameraName, base64, mime, width, height, context }
 * Saves to server/uploads/photos/{userId}/{cameraId}/{photoId}.{ext}
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { cameraId, cameraName, base64, mime, width, height, context } = req.body;
    if (!cameraId || !base64) {
      return res.status(400).json({ error: 'cameraId and base64 are required' });
    }

    // Strip and validate data URL prefix strictly
    let data = base64;
    let finalMime = mime || 'image/jpeg';
    const m = /^data:(image\/(jpeg|jpg|png|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(base64);
    if (m) {
      finalMime = m[1];
      data = m[3];
    } else if (base64.startsWith('data:')) {
      return res.status(400).json({ error: 'Invalid base64 image data format' });
    }
    
    if (!ALLOWED_MIME.includes(finalMime)) {
      return res.status(400).json({ error: `Unsupported mime: ${finalMime}` });
    }

    let buffer;
    try {
      buffer = Buffer.from(data, 'base64');
    } catch (err) {
      return res.status(400).json({ error: 'Invalid base64 encoding' });
    }
    
    if (buffer.length > MAX_SIZE_BYTES) {
      return res.status(413).json({ error: `Photo too large (${(buffer.length / 1024 / 1024).toFixed(2)}MB > 5MB)` });
    }
    // Minimum 100 bytes for any JPEG (was too strict at 1KB)
    if (buffer.length < 100) {
      return res.status(400).json({ error: 'Photo too small (< 100 bytes)' });
    }

    // Validate camera belongs to user
    const camera = await db.getCameraById(cameraId);
    if (!camera) return res.status(404).json({ error: 'Camera not found' });
    if (camera.ownerId !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    // Compute hash for dedup
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    // Path: server/uploads/photos/{userId}/{cameraId}/{photoId}.{ext}
    const ext = finalMime === 'image/png' ? 'png'
              : finalMime === 'image/webp' ? 'webp'
              : 'jpg';
    const userDir = path.join(UPLOAD_ROOT, req.user.id, cameraId);
    ensureDir(userDir);
    const photoId = `photo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const filename = `${photoId}.${ext}`;
    const fullPath = path.join(userDir, filename);
    const relativePath = path.join(req.user.id, cameraId, filename).replace(/\\/g, '/');

    // Write file with explicit permissions (644 = rw-r--r--)
    fs.writeFileSync(fullPath, buffer, { mode: 0o644 });

    // Generate a tiny thumbnail (optional, but the client can fall back to url)
    // For now we just point thumbnailUrl to url — list view lazy-loads the same
    const url = `/uploads/photos/${relativePath}`;

    const photo = await db.createPhoto({
      ownerId: req.user.id,
      cameraId,
      cameraName: cameraName || camera.name,
      filename,
      relativePath,
      url,
      thumbnailUrl: url, // same for now; could be regenerated lazily
      size: buffer.length,
      width: width || null,
      height: height || null,
      sha256,
      context: context || null
    });

    logger.info(`Photo captured: ${photoId} (${(buffer.length / 1024).toFixed(1)}KB) for camera ${cameraId} by user ${req.user.id}`);
    res.status(201).json({ ok: true, photo });
  } catch (err) {
    logger.error('Photo upload error:', err);
    res.status(500).json({ error: 'Failed to save photo' });
  }
});

/**
 * GET /api/photos
 * Query: ?cameraId&limit&since
 * Returns the user's photo list (metadata only).
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { cameraId, limit, since } = req.query;
    const photos = await db.getPhotosByOwner(req.user.id, {
      cameraId: cameraId || undefined,
      limit: limit ? Math.min(parseInt(limit) || 100, 500) : 200,
      since: since || undefined
    });
    res.json({ ok: true, count: photos.length, photos });
  } catch (err) {
    logger.error('List photos error:', err);
    res.status(500).json({ error: 'Failed to list photos' });
  }
});

/**
 * GET /api/photos/stats — Per-camera counts and recent total
 */
router.get('/stats', authenticate, async (req, res) => {
  try {
    const stats = await db.getPhotoStats(req.user.id);
    res.json({ ok: true, ...stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * DELETE /api/photos/:id — Owner-only delete + file cleanup
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const photo = await db.getPhotoById(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    if (photo.ownerId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    // Remove file
    const filePath = path.join(UPLOAD_ROOT, photo.relativePath);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) { logger.warn('File delete failed:', e.message); }
    }
    await db.deletePhoto(req.params.id, req.user.id);
    res.json({ ok: true, message: 'Photo deleted' });
  } catch (err) {
    logger.error('Delete photo error:', err);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

module.exports = router;
