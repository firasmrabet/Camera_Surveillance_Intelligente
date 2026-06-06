const { io } = require('socket.io-client');
const socket = io('http://localhost:5000', { transports: ['websocket', 'polling'] });
socket.on('connect', () => {
  console.log('connected', socket.id);
  socket.emit('subscribe-camera', 'cam-a0c39fb0');
  socket.emit('start-detection', 'cam-a0c39fb0');
  console.log('emitted start-detection');
  setTimeout(() => { socket.disconnect(); process.exit(0); }, 12000);
});
socket.on('detection', (d) => {
  console.log('DETECTION:', JSON.stringify(d).substring(0, 500));
});
socket.on('detection-error', (d) => console.log('DETECTION-ERROR:', JSON.stringify(d)));
socket.on('connect_error', (e) => { console.log('ERR', e.message); process.exit(1); });
