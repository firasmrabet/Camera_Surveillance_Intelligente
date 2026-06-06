const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB() {
  ensureDataDir();
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    logger.error('Failed to load DB file:', e.message);
  }
  return { users: [], cameras: [], alerts: [], photos: [], settings: [] };
}

function saveDB(data) {
  ensureDataDir();
  try {
    const tmpFile = DB_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.copyFileSync(tmpFile, DB_FILE);
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  } catch (e) {
    logger.error('Failed to save DB file:', e.message);
  }
}

let User, Camera, Alert, Settings, Photo;
let connected = false;
let fileDB = loadDB();

// Normalize all camera URLs on load: https→http for non-standard ports
function normalizeCameraUrls(db) {
  if (!db.cameras) return;
  let changed = false;
  for (const cam of db.cameras) {
    if (cam.url && cam.url.startsWith('https://')) {
      try {
        const p = new URL(cam.url);
        const port = parseInt(p.port) || 443;
        if (port !== 443 && port !== 4433) {
          p.protocol = 'http:';
          cam.url = p.toString();
          changed = true;
        }
      } catch (_) {}
    }
  }
  if (changed) {
    logger.info('[DB] Normalized camera URLs (https→http for non-standard ports)');
    saveDB(db);
  }
}
normalizeCameraUrls(fileDB);

logger.info(`[DB] Loaded ${fileDB.users.length} users, ${fileDB.cameras.length} cameras, ${fileDB.photos.length} photos from db.json`);

// Auto-save debounce for non-critical data
let saveTimeout = null;
let lastSaveTime = 0;
function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveDB(fileDB);
    lastSaveTime = Date.now();
  }, 200);
}

// Force immediate save for critical data (users, cameras, photos)
function forceSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveDB(fileDB);
  lastSaveTime = Date.now();
}

// Auto-save on exit — multiple handlers to catch all cases
function saveOnExit() {
  saveDB(fileDB);
}
process.on('SIGINT', () => { saveOnExit(); process.exit(0); });
process.on('SIGTERM', () => { saveOnExit(); process.exit(0); });
process.on('beforeExit', saveOnExit);
process.on('exit', saveOnExit);

// ========= Mongoose schemas (unchanged) =========
const userSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  googleId: { type: String, sparse: true, unique: true },
  email: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  avatar: String,
  role: { type: String, default: 'user' },
  password: String,
  phoneNumbers: [{
    number: { type: String },
    label: { type: String, default: 'primary' },
    active: { type: Boolean, default: true }
  }],
  knownFaces: [{
    id: { type: String },
    name: { type: String, required: true },
    embedding: { type: [Number] },
    thumbnail: { type: String },
    addedAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
}, { collection: 'users' });

const cameraSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  name: { type: String, required: true },
  location: { type: String, required: true },
  description: String,
  tags: [String],
  timezone: { type: String, default: 'UTC' },
  url: { type: String, required: true },
  status: { type: String, default: 'online' },
  resolution: { type: String, default: '1280x720' },
  fps: { type: Number, default: 15 },
  detectionEnabled: { type: Boolean, default: true },
  sensitivity: { type: String, default: 'medium' },
  vendor: String,
  model: String,
  protocol: { type: String, default: 'mjpeg' },
  connection: {
    host: String,
    port: Number,
    path: String,
    snapshotPath: String,
    username: String,
    authType: { type: String, default: 'basic' },
    useTLS: { type: Boolean, default: false },
    password: String,
    apiKey: String,
    clientSecret: String,
    token: String
  },
  capabilities: {
    ptz: { type: Boolean, default: false },
    audio: { type: Boolean, default: false },
    codec: { type: String, default: 'h264' },
    resolution: String,
    fps: Number
  },
  network: {
    behindNAT: { type: Boolean, default: false },
    publicUrl: String,
    relayRequired: { type: Boolean, default: false },
    preferWebRTC: { type: Boolean, default: false }
  },
  health: {
    maxReconnectAttempts: { type: Number, default: 10 },
    heartbeatIntervalSec: { type: Number, default: 30 },
    lastTestAt: Date,
    lastTestResult: mongoose.Schema.Types.Mixed,
    lastTestError: String
  },
  zones: [mongoose.Schema.Types.Mixed],
  ownerId: { type: String, required: true, index: true },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'cameras' });

const alertSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  cameraId: { type: String, required: true, index: true },
  ownerId: { type: String, required: true, index: true },
  type: { type: String, required: true },
  severity: { type: String, default: 'warning' },
  confidence: { type: Number, default: 0 },
  details: mongoose.Schema.Types.Mixed,
  frameBase64: { type: String },
  clip_path: { type: String },
  timestamp: { type: Date, default: Date.now },
  status: { type: String, default: 'active' },
  acknowledgedBy: String,
  acknowledgedAt: Date,
  resolvedBy: String,
  resolvedAt: Date
}, { collection: 'alerts' });

const photoSchema = new mongoose.Schema({
  id: { type: String, unique: true, index: true },
  ownerId: { type: String, required: true, index: true },
  cameraId: { type: String, required: true, index: true },
  cameraName: String,
  filename: { type: String, required: true },
  relativePath: { type: String, required: true },
  url: { type: String, required: true },
  thumbnailUrl: String,
  size: { type: Number, default: 0 },
  width: Number,
  height: Number,
  context: {
    activePreset: String,
    filtersApplied: Boolean,
    zoom: Number,
    rotation: Number,
    detections: mongoose.Schema.Types.Mixed,
    threatLevel: String
  },
  sha256: String,
  capturedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'photos' });

const settingsSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  notifications: {
    sms: { type: Boolean, default: true },
    email: { type: Boolean, default: true },
    push: { type: Boolean, default: true },
    cooldownSeconds: { type: Number, default: 30 },
    maxAlertsPerHour: { type: Number, default: 20 }
  },
  detection: {
    confidenceThreshold: { type: Number, default: 0.6 },
    objectDetection: { type: Boolean, default: true },
    faceDetection: { type: Boolean, default: true },
    motionDetection: { type: Boolean, default: true },
    behaviorAnalysis: { type: Boolean, default: true },
    intrusionDetection: { type: Boolean, default: true },
    loiteringDetection: { type: Boolean, default: true },
    unattendedObject: { type: Boolean, default: true }
  },
  security: {
    twoFactorEnabled: { type: Boolean, default: false },
    sessionTimeout: { type: Number, default: 3600 },
    allowedIPs: [String]
  },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'settings' });

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.warn('No MONGODB_URI set, using JSON file persistence');
    return false;
  }
  try {
    await mongoose.connect(uri);
    connected = true;
    User = mongoose.models.User || mongoose.model('User', userSchema);
    Camera = mongoose.models.Camera || mongoose.model('Camera', cameraSchema);
    Alert = mongoose.models.Alert || mongoose.model('Alert', alertSchema);
    Settings = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);
    Photo = mongoose.models.Photo || mongoose.model('Photo', photoSchema);
    logger.info('Connected to MongoDB');
    return true;
  } catch (err) {
    logger.error('MongoDB connection failed:', err.message);
    logger.info('Falling back to JSON file persistence');
    return false;
  }
}

function isConnected() {
  return connected && User && Camera && Alert && Settings && Photo;
}

// ========= Helpers for file-based storage =========
function findInFile(collection, predicate) {
  return fileDB[collection].find(predicate) || null;
}

function filterInFile(collection, predicate) {
  return fileDB[collection].filter(predicate);
}

function upsertInFile(collection, id, data) {
  const idx = fileDB[collection].findIndex(item => item.id === id);
  if (idx >= 0) {
    fileDB[collection][idx] = { ...fileDB[collection][idx], ...data };
  } else {
    fileDB[collection].push(data);
  }
  if (['users', 'cameras', 'photos'].includes(collection)) {
    forceSave();
  } else {
    scheduleSave();
  }
}

function deleteFromFile(collection, id) {
  const idx = fileDB[collection].findIndex(item => item.id === id);
  if (idx >= 0) {
    fileDB[collection].splice(idx, 1);
    forceSave();
    return true;
  }
  return false;
}

const db = {
  connectDB,

  async createUser(data) {
    const id = uuidv4();
    const user = { ...data, id, createdAt: new Date().toISOString() };
    if (isConnected()) {
      const doc = await User.create({ ...data, id });
      return doc.toObject();
    }
    upsertInFile('users', id, user);
    return user;
  },

  async findOrCreateGoogleUser(profile) {
    if (!isConnected()) {
      let user = findInFile('users', u => u.googleId === profile.id);
      if (user) return user;
      user = findInFile('users', u => u.email === profile.emails[0].value);
      if (user) {
        user.googleId = profile.id;
        if (!user.avatar && profile.photos?.[0]?.value) user.avatar = profile.photos[0].value;
        forceSave();
        return user;
      }
      const newUser = {
        id: uuidv4(),
        email: profile.emails[0].value,
        name: profile.displayName,
        avatar: profile.photos?.[0]?.value,
        googleId: profile.id,
        role: 'admin',
        createdAt: new Date().toISOString(),
        phoneNumbers: [],
        knownFaces: []
      };
      upsertInFile('users', newUser.id, newUser);
      const defaultSettings = {
        userId: newUser.id,
        notifications: { sms: true, email: true, push: true, cooldownSeconds: 30, maxAlertsPerHour: 20 },
        detection: { confidenceThreshold: 0.6, objectDetection: true, faceDetection: true, motionDetection: true, behaviorAnalysis: true, intrusionDetection: true, loiteringDetection: true, unattendedObject: true },
        security: { twoFactorEnabled: false, sessionTimeout: 3600, allowedIPs: [] },
        createdAt: new Date().toISOString()
      };
      upsertInFile('settings', newUser.id, defaultSettings);
      return newUser;
    }
    let user = await User.findOne({ googleId: profile.id });
    if (user) return user.toObject();
    user = await User.findOne({ email: profile.emails[0].value });
    if (user) {
      user.googleId = profile.id;
      if (!user.avatar && profile.photos?.[0]?.value) user.avatar = profile.photos[0].value;
      await user.save();
      return user.toObject();
    }
    const newUser = await User.create({
      id: uuidv4(),
      googleId: profile.id,
      email: profile.emails[0].value,
      name: profile.displayName,
      avatar: profile.photos?.[0]?.value
    });
    const sid = newUser.id;
    await Settings.create({ userId: sid });
    return newUser.toObject();
  },

  async getUserByEmail(email) {
    if (isConnected()) {
      const doc = await User.findOne({ email }).lean();
      return doc || null;
    }
    return findInFile('users', u => u.email === email);
  },

  async getUserById(id) {
    if (isConnected()) {
      const doc = await User.findOne({ id }).lean();
      return doc || null;
    }
    return findInFile('users', u => u.id === id);
  },

  async updateUser(id, updates) {
    if (isConnected()) {
      const doc = await User.findOneAndUpdate({ id }, updates, { new: true }).lean();
      return doc || null;
    }
    const user = findInFile('users', u => u.id === id);
    if (!user) return null;
    Object.assign(user, updates);
    forceSave();
    return user;
  },

  async createCamera(data) {
    const id = `cam-${uuidv4().slice(0, 8)}`;
    const cam = { ...data, id, createdAt: new Date().toISOString() };
    if (isConnected()) {
      const doc = await Camera.create({ ...data, id });
      return doc.toObject();
    }
    upsertInFile('cameras', id, cam);
    return cam;
  },

  async getCameraById(id) {
    if (isConnected()) {
      return await Camera.findOne({ id }).lean() || null;
    }
    return findInFile('cameras', c => c.id === id);
  },

  async getCamerasByOwner(ownerId) {
    if (isConnected()) {
      return await Camera.find({ ownerId }).sort({ createdAt: -1 }).lean();
    }
    return filterInFile('cameras', c => c.ownerId === ownerId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async updateCamera(id, updates) {
    if (isConnected()) {
      return await Camera.findOneAndUpdate({ id }, updates, { new: true }).lean() || null;
    }
    const cam = findInFile('cameras', c => c.id === id);
    if (!cam) return null;
    Object.assign(cam, updates);
    forceSave();
    return cam;
  },

  async deleteCamera(id) {
    if (isConnected()) {
      await Camera.deleteOne({ id });
      return true;
    }
    return deleteFromFile('cameras', id);
  },

  async createAlert(data) {
    const id = uuidv4();
    const alert = { ...data, id, timestamp: new Date().toISOString(), status: 'active' };
    if (isConnected()) {
      const doc = await Alert.create({ ...data, id });
      return doc.toObject();
    }
    upsertInFile('alerts', id, alert);
    return alert;
  },

  async getAlertById(id) {
    if (isConnected()) {
      return await Alert.findOne({ id }).lean() || null;
    }
    return findInFile('alerts', a => a.id === id);
  },

  async getAlertsByOwner(ownerId) {
    if (isConnected()) {
      return await Alert.find({ ownerId }).sort({ timestamp: -1 }).lean();
    }
    return filterInFile('alerts', a => a.ownerId === ownerId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  async updateAlert(id, updates) {
    if (isConnected()) {
      return await Alert.findOneAndUpdate({ id }, updates, { new: true }).lean() || null;
    }
    const alert = findInFile('alerts', a => a.id === id);
    if (!alert) return null;
    Object.assign(alert, updates);
    forceSave();
    return alert;
  },

  async deleteAlert(id) {
    if (isConnected()) {
      await Alert.deleteOne({ id });
      return true;
    }
    return deleteFromFile('alerts', id);
  },

  async getRecentAlertCount(ownerId, minutes = 60) {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    if (isConnected()) {
      return await Alert.countDocuments({ ownerId, timestamp: { $gt: cutoff } });
    }
    return filterInFile('alerts', a => a.ownerId === ownerId && new Date(a.timestamp) > cutoff).length;
  },

  async getSettings(userId) {
    if (isConnected()) {
      return await Settings.findOne({ userId }).lean() || null;
    }
    return findInFile('settings', s => s.userId === userId);
  },

  async updateSettings(userId, updates) {
    if (isConnected()) {
      return await Settings.findOneAndUpdate({ userId }, { $set: updates }, { upsert: true, new: true }).lean();
    }
    let existing = findInFile('settings', s => s.userId === userId);
    if (!existing) {
      existing = { userId, notifications: { sms: true, email: true, push: true, cooldownSeconds: 30, maxAlertsPerHour: 20 }, detection: { confidenceThreshold: 0.6, objectDetection: true, faceDetection: true, motionDetection: true, behaviorAnalysis: true, intrusionDetection: true, loiteringDetection: true, unattendedObject: true }, security: { twoFactorEnabled: false, sessionTimeout: 3600, allowedIPs: [] }, createdAt: new Date().toISOString() };
      upsertInFile('settings', userId, existing);
    }
    if (updates.notifications) existing.notifications = { ...(existing.notifications || {}), ...updates.notifications };
    if (updates.detection) existing.detection = { ...(existing.detection || {}), ...updates.detection };
    if (updates.security) existing.security = { ...(existing.security || {}), ...updates.security };
    forceSave();
    return existing;
  },

  async getAllUsers() {
    if (isConnected()) return await User.find({}).lean();
    return fileDB.users;
  },

  async getAllCameras() {
    if (isConnected()) return await Camera.find({}).lean();
    return fileDB.cameras;
  },

  async getAllAlerts() {
    if (isConnected()) return await Alert.find({}).lean();
    return fileDB.alerts;
  },

  async createPhoto(data) {
    const id = `photo-${uuidv4().slice(0, 12)}`;
    const photo = { ...data, id, createdAt: new Date().toISOString() };
    if (isConnected()) {
      const doc = await Photo.create({ ...data, id });
      return doc.toObject();
    }
    upsertInFile('photos', id, photo);
    return photo;
  },

  async getPhotoById(id) {
    if (isConnected()) {
      return await Photo.findOne({ id }).lean() || null;
    }
    return findInFile('photos', p => p.id === id);
  },

  async getPhotosByOwner(ownerId, { cameraId, limit = 100, since } = {}) {
    if (isConnected()) {
      const query = { ownerId };
      if (cameraId) query.cameraId = cameraId;
      if (since) query.capturedAt = { $gt: new Date(since) };
      return await Photo.find(query).sort({ capturedAt: -1 }).limit(limit).lean();
    }
    let photos = filterInFile('photos', p => {
      if (p.ownerId !== ownerId) return false;
      if (cameraId && p.cameraId !== cameraId) return false;
      if (since && new Date(p.capturedAt) <= new Date(since)) return false;
      return true;
    });
    return photos.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt)).slice(0, limit);
  },

  async deletePhoto(id, ownerId) {
    if (isConnected()) {
      const result = await Photo.deleteOne({ id, ownerId });
      return result.deletedCount > 0;
    }
    const photo = findInFile('photos', p => p.id === id);
    if (photo && photo.ownerId === ownerId) {
      return deleteFromFile('photos', id);
    }
    return false;
  },

  async getPhotoStats(ownerId) {
    if (isConnected()) {
      const total = await Photo.countDocuments({ ownerId });
      const last24h = await Photo.countDocuments({
        ownerId,
        capturedAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      });
      const byCamera = await Photo.aggregate([
        { $match: { ownerId } },
        { $group: { _id: '$cameraId', count: { $sum: 1 }, lastCapture: { $max: '$capturedAt' } } }
      ]);
      return { total, last24h, byCamera };
    }
    const userPhotos = filterInFile('photos', p => p.ownerId === ownerId);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const camMap = {};
    let total = 0, last24h = 0;
    for (const p of userPhotos) {
      total++;
      if (new Date(p.capturedAt) > cutoff) last24h++;
      if (!camMap[p.cameraId]) camMap[p.cameraId] = { count: 0, lastCapture: p.capturedAt };
      camMap[p.cameraId].count++;
      if (new Date(p.capturedAt) > new Date(camMap[p.cameraId].lastCapture)) camMap[p.cameraId].lastCapture = p.capturedAt;
    }
    return { total, last24h, byCamera: Object.entries(camMap).map(([camId, v]) => ({ _id: camId, ...v })) };
  }
};

module.exports = db;
