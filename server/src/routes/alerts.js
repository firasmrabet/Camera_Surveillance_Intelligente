const express = require('express');
const router = express.Router();
const { authenticate } = require('./auth');
const db = require('../utils/database');
const { logger } = require('../utils/logger');

// Get all alerts for current user
router.get('/', authenticate, async (req, res) => {
  try {
    const { cameraId, status, limit = 50, offset = 0 } = req.query;
    let alerts = await db.getAlertsByOwner(req.user.id);

    if (cameraId) {
      alerts = alerts.filter(a => a.cameraId === cameraId);
    }
    if (status) {
      alerts = alerts.filter(a => a.status === status);
    }

    const total = alerts.length;
    alerts = alerts.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    res.json({ alerts, total, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (error) {
    logger.error('Error fetching alerts:', error);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// Get alert by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const alert = await db.getAlertById(req.params.id);
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }
    res.json(alert);
  } catch (error) {
    logger.error('Error fetching alert:', error);
    res.status(500).json({ error: 'Failed to fetch alert' });
  }
});

// Mark alert as acknowledged
router.put('/:id/acknowledge', authenticate, async (req, res) => {
  try {
    const alert = await db.getAlertById(req.params.id);
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    const updatedAlert = await db.updateAlert(req.params.id, {
      status: 'acknowledged',
      acknowledgedBy: req.user.id,
      acknowledgedAt: new Date().toISOString()
    });

    logger.info(`Alert acknowledged: ${req.params.id} by user ${req.user.id}`);
    res.json(updatedAlert);
  } catch (error) {
    logger.error('Error acknowledging alert:', error);
    res.status(500).json({ error: 'Failed to acknowledge alert' });
  }
});

// Mark alert as resolved
router.put('/:id/resolve', authenticate, async (req, res) => {
  try {
    const alert = await db.getAlertById(req.params.id);
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    const updatedAlert = await db.updateAlert(req.params.id, {
      status: 'resolved',
      resolvedBy: req.user.id,
      resolvedAt: new Date().toISOString()
    });

    logger.info(`Alert resolved: ${req.params.id} by user ${req.user.id}`);
    res.json(updatedAlert);
  } catch (error) {
    logger.error('Error resolving alert:', error);
    res.status(500).json({ error: 'Failed to resolve alert' });
  }
});

// Delete alert
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const alert = await db.getAlertById(req.params.id);
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    await db.deleteAlert(req.params.id);
    logger.info(`Alert deleted: ${req.params.id}`);
    res.json({ message: 'Alert deleted successfully' });
  } catch (error) {
    logger.error('Error deleting alert:', error);
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

// Get alert statistics
router.get('/stats/summary', authenticate, async (req, res) => {
  try {
    const alerts = await db.getAlertsByOwner(req.user.id);
    const now = new Date();

    const stats = {
      total: alerts.length,
      active: alerts.filter(a => a.status === 'active').length,
      acknowledged: alerts.filter(a => a.status === 'acknowledged').length,
      resolved: alerts.filter(a => a.status === 'resolved').length,
      last24h: alerts.filter(a => {
        const alertDate = new Date(a.timestamp);
        return (now - alertDate) < 24 * 60 * 60 * 1000;
      }).length,
      lastHour: alerts.filter(a => {
        const alertDate = new Date(a.timestamp);
        return (now - alertDate) < 60 * 60 * 1000;
      }).length,
      byType: {}
    };

    alerts.forEach(alert => {
      stats.byType[alert.type] = (stats.byType[alert.type] || 0) + 1;
    });

    res.json(stats);
  } catch (error) {
    logger.error('Error fetching alert stats:', error);
    res.status(500).json({ error: 'Failed to fetch alert statistics' });
  }
});

module.exports = router;
