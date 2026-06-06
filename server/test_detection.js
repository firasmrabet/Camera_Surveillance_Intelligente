const { io } = require('socket.io-client');
const sock = io('http://localhost:5000', { transports: ['websocket', 'polling'] });
sock.on('connect', () => {
  console.log('Connected:', sock.id);
  sock.emit('subscribe-camera', 'cam-91473391');
  setTimeout(() => {
    console.log('Emitting start-detection...');
    sock.emit('start-detection', 'cam-91473391');
  }, 500);
});
let detCount = 0;
sock.on('detections', (d) => {
  detCount++;
  if (detCount <= 5) console.log(`Detection #${detCount}:`, JSON.stringify(d).slice(0, 500));
});
sock.on('alert', (a) => console.log('ALERT:', JSON.stringify(a).slice(0, 200)));
setTimeout(() => {
  sock.emit('stop-detection', 'cam-91473391');
  console.log(`Stopping after ${detCount} detections`);
  sock.close();
  process.exit(0);
}, 10000);
