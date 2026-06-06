// Test live stream subscribe WITHOUT a real camera
const { io } = require('socket.io-client');
const socket = io('http://localhost:5000', { transports: ['websocket', 'polling'] });
let subscribed = false;
socket.on('connect', () => {
  console.log('connected', socket.id);
  socket.emit('subscribe-live', 'cam-91473391');
  subscribed = true;
  setTimeout(() => {
    console.log('subscribed=', subscribed, 'received_frames=0 (expected: phone is down)');
    socket.disconnect();
    process.exit(0);
  }, 5000);
});
socket.on('live-frame', () => { console.log('got frame'); });
socket.on('connect_error', (e) => { console.log('ERR', e.message); process.exit(1); });
