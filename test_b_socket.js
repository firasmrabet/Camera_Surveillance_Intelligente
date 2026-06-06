// Test B (advanced): Connect via Socket.IO and trigger detection
const fs = require('fs');
const path = require('path');
const { io } = require('C:\\Users\\Mrabet\\Desktop\\projet_camera\\server\\node_modules\\socket.io-client');

const TOKEN = fs.readFileSync('C:\\Users\\Mrabet\\Desktop\\projet_camera\\test_token.txt', 'utf8').trim();
const CAMERA_ID = 'cam-2bbe5ea7';

console.log('=== Test B: AI Detection via Socket ===\n');

const socket = io('http://localhost:5000', {
  auth: { token: TOKEN },
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log('[OK] Connected:', socket.id);
  console.log('Triggering start-detection for', CAMERA_ID);
  socket.emit('start-detection', CAMERA_ID);
});

socket.on('detection-result', (data) => {
  console.log('[DETECTION]', JSON.stringify(data, null, 2).slice(0, 400));
});

socket.on('global-alert', (alert) => {
  console.log('[ALERT]', JSON.stringify(alert, null, 2).slice(0, 400));
});

socket.on('connect_error', (e) => {
  console.error('[ERR] connect_error:', e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('\nTimeout reached, disconnecting');
  socket.disconnect();
  process.exit(0);
}, 20000);
