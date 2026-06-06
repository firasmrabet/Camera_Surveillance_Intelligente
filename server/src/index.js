const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
require('dotenv').config();

const { connectDB } = require('./utils/database');
const db = require('./utils/database');
const authRoutes = require('./routes/auth');
const cameraRoutes = require('./routes/cameras');
const alertRoutes = require('./routes/alerts');
const settingsRoutes = require('./routes/settings');
const debugRoutes = require('./routes/debug');
const aiRoutes = require('./routes/ai');
const photoRoutes = require('./routes/photos');
const { initializeAIDetection } = require('./services/aiDetection');
const { initializeNotificationService } = require('./services/notifications');
const { CameraManager } = require('./services/cameraManager');
const unifiedAI = require('./services/unifiedAI');
const { logger } = require('./utils/logger');

const vault = require('./utils/vault');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy: false
}));
app.use(cors({
  origin: true,
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 500,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Session config for Passport
app.use(session({
  secret: process.env.SESSION_SECRET || 'sentinelai-session',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Static files
app.use('/models', express.static(path.join(__dirname, '../models')));
// HLS segments (m3u8 + ts) for RTSP/RTMP→HLS proxy
app.use('/hls', express.static(path.join(__dirname, '../public/hls'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// User-captured photos
app.use('/uploads/photos', express.static(path.join(__dirname, '../uploads/photos'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// AI Video Clips
app.use('/clips', express.static(path.join(__dirname, '../../ai/sentinel_data/clips'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/cameras', cameraRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/photos', photoRoutes);

// Serve saved clips statically
const clipsDir = path.join(__dirname, '../clips');
app.use('/clips', express.static(clipsDir));

// Health check — Chap 14.2 : expose engine + stats
app.get('/api/health', (req, res) => {
  const statsTracker = require('./services/statsTracker');
  const aiBridge = require('./services/aiBridge');
  res.json({
    status: 'operational',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    engine: aiBridge.getEngineInfo ? aiBridge.getEngineInfo() : { name: 'unknown' },
    stats: statsTracker.getSnapshot(),
  });
});

// Initialize services
const cameraManager = new CameraManager(io);
const aiDetection = initializeAIDetection(io);
const notifications = initializeNotificationService(io);
const PythonStreamer = require('./services/pythonStreamer');
const pythonStreamer = new PythonStreamer(cameraManager);
const LiveJPEGStreamer = require('./services/liveStreamer');
const liveStreamer = new LiveJPEGStreamer(cameraManager);
liveStreamer.setIO(io);
app.locals.liveStreamer = liveStreamer;

// OPTIMISATION : partage de frame entre stream MJPEG et detection AI
// (evite une 2eme connexion HTTP vers IP Webcam qui sature)
cameraManager.setLiveStreamer(liveStreamer);

cameraManager.setAIDetection(aiDetection);
aiDetection.setNotifications(notifications);
app.locals.cameraManager = cameraManager;
app.locals.aiDetection = aiDetection;
app.locals.notifications = notifications;
app.locals.pythonStreamer = pythonStreamer;

// Initialize unified AI (YOLOv8 + Pose + Weapons + Faces)
unifiedAI.initialize(io).catch(e => logger.error('UnifiedAI init error:', e));
unifiedAI.setNotifications(notifications);
cameraManager.setUnifiedAI(unifiedAI);
app.locals.unifiedAI = unifiedAI;

// WebSocket connections
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    socket.userEmail = decoded.email;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id} (user: ${socket.userId || 'anonymous'})`);

  socket.on('subscribe-camera', (cameraId) => {
    socket.join(`camera-${cameraId}`);
  });

  socket.on('unsubscribe-camera', (cameraId) => {
    socket.leave(`camera-${cameraId}`);
  });

  socket.on('subscribe-live', (data) => {
    const cameraId = typeof data === 'string' ? data : data.cameraId;
    const subId = typeof data === 'string' ? socket.id : data.subId;
    
    // Create a proxy socket object so multiple React mounts on the same real socket
    // are counted as distinct subscribers in LiveStreamer's Set.
    const proxySocket = {
      id: `${socket.id}-${subId}`,
      originalId: socket.id,
      join: (...args) => socket.join(...args),
      leave: (...args) => socket.leave(...args),
      emit: (...args) => socket.emit(...args)
    };
    
    liveStreamer.subscribe(cameraId, proxySocket);
  });

  socket.on('unsubscribe-live', (data) => {
    const cameraId = typeof data === 'string' ? data : data.cameraId;
    const subId = typeof data === 'string' ? socket.id : data.subId;
    
    const proxySocket = {
      id: `${socket.id}-${subId}`,
      originalId: socket.id,
      join: (...args) => socket.join(...args),
      leave: (...args) => socket.leave(...args),
      emit: (...args) => socket.emit(...args)
    };
    
    liveStreamer.unsubscribe(cameraId, proxySocket);
  });

  // Stream URL is now fetched via REST: GET /api/cameras/:id/stream-url
  // Socket.IO is used only for detection results and alerts
  socket.on('start-detection', async (cameraId) => {
    await cameraManager.startDetection(cameraId, aiDetection);
  });

  socket.on('stop-detection', (cameraId) => {
    cameraManager.stopDetection(cameraId);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
    
    // Instead of passing the raw socket, LiveStreamer now holds proxy objects.
    // We need to unsubscribe all proxy objects that belong to this real socket.
    for (const [cameraId, stream] of liveStreamer.streams) {
      for (const sub of stream.subscribers) {
        if (sub.originalId === socket.id || sub.id === socket.id) {
          liveStreamer.unsubscribe(cameraId, sub);
        }
      }
    }
  });
});

// Serve React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/build', 'index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Use the configured port (default 5000)
const PORT = process.env.PORT || 5000;

async function startServer() {
  const mongoConnected = await connectDB();
  if (mongoConnected) {
    logger.info('MongoDB connected successfully');
  } else {
    logger.warn('Running without MongoDB persistence');
  }

  server.listen(PORT, () => {
    logger.info(`
  ============================================
  AI Camera Security System Server
  ============================================
  Server running on port ${PORT}
  Environment: ${process.env.NODE_ENV || 'development'}
  MongoDB: ${mongoConnected ? 'Connected' : 'Disabled'}
  Google OAuth: ${process.env.GOOGLE_CLIENT_ID ? 'Configured' : 'Not configured'}
  WebSocket: Ready
  ============================================
    `);

    cameraManager.initialize();

    // Load existing cameras from database so detection works after restart
    cameraManager.loadCamerasFromDB(db, vault).catch(e => logger.error('Camera load error:', e.message));
  });
}

startServer();

module.exports = { app, server, io };
