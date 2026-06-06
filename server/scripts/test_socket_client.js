const fs = require('fs');
const io = require('socket.io-client');

const tokenPath = __dirname + '/token.json';
if (!fs.existsSync(tokenPath)) {
  console.error('token.json not found. Run get_token.js first.');
  process.exit(1);
}

(async () => {
  try {
    const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    const tokenUserId = tokenData.user && tokenData.user.id;
    const cameraId = 'cam-001';

    // Prefer the camera.ownerId from the debug DB to avoid token/owner mismatches
    let ownerId = tokenUserId;
    try {
      const resp = await fetch('http://localhost:5000/api/debug/db');
      const debug = await resp.json();
      const cam = (debug.cameras || []).find(c => c.id === cameraId);
      if (cam && cam.ownerId) {
        ownerId = cam.ownerId;
      }
    } catch (err) {
      console.warn('Could not fetch debug DB, falling back to token user id');
    }

    console.log('Using ownerId for manual-alert:', ownerId);

    const socket = io('http://localhost:5000', { transports: ['websocket'] });

    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      socket.emit('subscribe-camera', cameraId);
      console.log('Subscribed to camera', cameraId);
      socket.emit('start-detection', cameraId);
      console.log('Requested start-detection for', cameraId);

      setTimeout(() => {
        console.log('Sending manual-alert...');
        socket.emit('manual-alert', { cameraId, ownerId, message: 'Integration test manual alert' });
      }, 5000);
    });

    socket.on('detections', (data) => {
      console.log('DETECTIONS:', JSON.stringify(data));
    });

    socket.on('alert', (data) => {
      console.log('ALERT (room):', JSON.stringify(data));
    });

    socket.on('global-alert', (data) => {
      console.log('GLOBAL ALERT:', JSON.stringify(data));
    });

    socket.on('notification', (data) => {
      console.log('NOTIFICATION:', JSON.stringify(data));
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    setTimeout(() => {
      console.log('Test complete, disconnecting');
      socket.disconnect();
      process.exit(0);
    }, 25000);
  } catch (err) {
    console.error('Test socket client error:', err);
    process.exit(1);
  }
})();
