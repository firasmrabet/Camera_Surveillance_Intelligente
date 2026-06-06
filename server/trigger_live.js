const { io } = require('socket.io-client');
const socket = io('http://localhost:5000', { transports: ['websocket', 'polling'] });
let frameCount = 0;
let totalBytes = 0;
let firstFrameAt = 0;
const start = Date.now();
socket.on('connect', () => {
  console.log('connected', socket.id);
  socket.emit('subscribe-live', 'cam-a0c39fb0');
  console.log('emitted subscribe-live');
  setTimeout(() => {
    const elapsed = (Date.now() - start) / 1000;
    const fps = frameCount / elapsed;
    console.log(`\n=== RESULTS ===`);
    console.log(`frames received: ${frameCount}`);
    console.log(`total bytes: ${totalBytes} (${(totalBytes/1024).toFixed(1)} KB)`);
    console.log(`elapsed: ${elapsed.toFixed(1)}s`);
    console.log(`avg FPS: ${fps.toFixed(2)}`);
    console.log(`latency first frame: ${firstFrameAt - start}ms`);
    if (frameCount > 0 && firstFrameAt) {
      console.log(`avg latency: ~${Math.round((Date.now() - firstFrameAt) / frameCount)}ms per frame`);
    }
    socket.disconnect();
    process.exit(0);
  }, 10000); // listen for 10 seconds
});
socket.on('live-frame', (data) => {
  if (frameCount === 0) firstFrameAt = Date.now();
  frameCount++;
  if (data instanceof Buffer || data instanceof ArrayBuffer) {
    totalBytes += data.byteLength || data.length;
  } else if (typeof data === 'string') {
    totalBytes += data.length;
  }
  if (frameCount % 5 === 0) {
    const sz = (data.byteLength || data.length || 0);
    console.log(`frame #${frameCount}: ${sz} bytes (magic: ${data[0]?.toString(16)} ${data[1]?.toString(16)} ${data[2]?.toString(16)})`);
  }
});
socket.on('connect_error', (e) => { console.log('ERR', e.message); process.exit(1); });
