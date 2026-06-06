const express = require('express');
const router = express.Router();
const db = require('../utils/database');

// WARNING: Debug route for local development only.
router.get('/db', async (req, res) => {
  try {
    // Use adapter methods when available (works for both Mongo and in-memory wrapper)
    const users = await (db.getAllUsers ? db.getAllUsers() : Promise.resolve([]));
    const cameras = await (db.getAllCameras ? db.getAllCameras() : (db._internal ? Promise.resolve(Array.from(db._internal.cameras.values())) : Promise.resolve([])));
    const alerts = await (db.getAllAlerts ? db.getAllAlerts() : (db._internal ? Promise.resolve(Array.from(db._internal.alerts.values())) : Promise.resolve([])));

    res.json({ users, cameras, alerts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to dump DB' });
  }
});

module.exports = router;
