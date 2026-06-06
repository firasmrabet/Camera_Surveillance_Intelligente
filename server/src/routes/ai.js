const express = require('express');
const router = express.Router();
const { authenticate } = require('./auth');
const aiBridge = require('../services/aiBridge');
const statsTracker = require('../services/statsTracker');
const { logger } = require('../utils/logger');

// GET /api/ai/engine-info — info sur l'engine sélectionné (LSTM vs heuristique)
router.get('/engine-info', (req, res) => {
  res.json(aiBridge.getEngineInfo ? aiBridge.getEngineInfo() : { name: 'unknown' });
});

// GET /api/ai/stats — Chap 14.2 : métriques de production
router.get('/stats', (req, res) => {
  const snap = statsTracker.getSnapshot();
  res.json(snap);
});

// POST /api/ai/alert-feedback — Chap 14.2 : confirmer/rejeter une alerte
// Body: { action: "confirm" | "dismiss", alertId?: string, latencyMs?: number }
router.post('/alert-feedback', authenticate, (req, res) => {
  const { action, latencyMs } = req.body || {};
  if (action === 'confirm') {
    statsTracker.recordConfirmed();
  } else if (action === 'dismiss') {
    statsTracker.recordDismissed();
  } else if (action === 'alert') {
    statsTracker.recordAlert(latencyMs);
  } else {
    return res.status(400).json({ error: 'action must be confirm, dismiss or alert' });
  }
  res.json({ ok: true, snapshot: statsTracker.getSnapshot() });
});

// POST /api/ai/extract-embedding - Extract face embedding from an image
// Body: { image: "base64jpeg" }  Returns: { faces: [{ bbox, embedding, score }] }
router.post('/extract-embedding', authenticate, async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Image required (base64)' });

    let base64 = image;
    if (base64.startsWith('data:')) {
      base64 = base64.split(',', 2)[1];
    }
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length < 100) {
      return res.status(400).json({ error: 'Invalid image data' });
    }

    const result = await aiBridge.extractEmbedding(buffer, 5);
    res.json(result);
  } catch (error) {
    logger.error('Extract embedding error:', error);
    res.status(500).json({ error: 'Failed to extract embedding' });
  }
});

// POST /api/ai/test-frame - Run full detection on a single frame (for testing)
router.post('/test-frame', authenticate, async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Image required' });
    let base64 = image;
    if (base64.startsWith('data:')) base64 = base64.split(',', 2)[1];
    const buffer = Buffer.from(base64, 'base64');

    const result = await aiBridge.detect(buffer, { knownFaces: [], zones: [] });
    res.json(result);
  } catch (error) {
    logger.error('Test frame error:', error);
    res.status(500).json({ error: 'Failed to process frame' });
  }
});

module.exports = router;
