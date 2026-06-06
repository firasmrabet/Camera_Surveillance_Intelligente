require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/camera_security';

const userSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  email: { type: String, unique: true },
  password: String,
  name: String,
  phone: String,
  role: String,
  createdAt: Date
}, { collection: 'users' });

const cameraSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: String,
  location: String,
  url: String,
  status: String,
  resolution: String,
  fps: Number,
  detectionEnabled: Boolean,
  sensitivity: String,
  zones: Array,
  ownerId: String,
  createdAt: Date
}, { collection: 'cameras' });

const settingsSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  notifications: Object,
  detection: Object,
  security: Object,
  createdAt: Date
}, { collection: 'settings' });

async function run() {
  console.log('Connecting to', MONGODB_URI);
  await mongoose.connect(MONGODB_URI, { autoIndex: true });
  const User = mongoose.models.User || mongoose.model('User', userSchema);
  const Camera = mongoose.models.Camera || mongoose.model('Camera', cameraSchema);
  const Settings = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@security.com';
  let admin = await User.findOne({ email: adminEmail }).lean();
  if (!admin) {
    const adminId = uuidv4();
    const hashed = bcrypt.hashSync('admin123', 10);
    const doc = await User.create({ id: adminId, email: adminEmail, password: hashed, name: 'System Admin', phone: '+21695795197', role: 'admin', createdAt: new Date() });
    admin = doc.toObject();
    console.log('Created admin user:', adminEmail);
  } else {
    console.log('Admin already exists:', adminEmail);
  }

  const cameras = [
    { id: 'cam-001', name: 'Front Door', location: 'Main Entrance' },
    { id: 'cam-002', name: 'Backyard', location: 'Back Yard' },
    { id: 'cam-003', name: 'Garage', location: 'Garage Area' }
  ];

  for (const c of cameras) {
    const exists = await Camera.findOne({ id: c.id }).lean();
    if (!exists) {
      await Camera.create({
        id: c.id,
        name: c.name,
        location: c.location,
        url: `rtsp://localhost:8554/${c.id}`,
        status: 'online',
        resolution: '1280x720',
        fps: 15,
        detectionEnabled: true,
        sensitivity: 'medium',
        zones: [],
        ownerId: admin.id || admin._id,
        createdAt: new Date()
      });
      console.log('Inserted camera', c.id);
    } else {
      console.log('Camera exists:', c.id);
    }
  }

  // Ensure settings
  const settingsExists = await Settings.findOne({ userId: admin.id || admin._id }).lean();
  if (!settingsExists) {
    await Settings.create({ userId: admin.id || admin._id, notifications: { sms: true, email: true, push: true, cooldownSeconds: 30, maxAlertsPerHour: 20 }, detection: { confidenceThreshold: 0.6 }, security: {}, createdAt: new Date() });
    console.log('Created default settings for admin');
  } else {
    console.log('Settings already exist for admin');
  }

  console.log('Seeding complete');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Seeding failed', err);
  process.exit(1);
});
