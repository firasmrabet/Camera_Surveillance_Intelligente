// Test the proxy response format
const http = require('http');
const fs = require('fs');
const token = fs.readFileSync('C:\\Users\\Mrabet\\AppData\\Local\\Temp\\opencode\\token.txt', 'utf8').trim();
console.log('token len:', token.length);

const req = http.request({
  hostname: 'localhost',
  port: 5000,
  path: '/api/cameras/cam-b6d96d86/stream',
  method: 'GET',
  headers: { Authorization: 'Bearer ' + token }
}, (res) => {
  console.log('STATUS:', res.statusCode);
  console.log('CT:', res.headers['content-type']);
  let bytes = 0;
  let firstChunk = null;
  res.on('data', (chunk) => {
    if (!firstChunk) firstChunk = chunk;
    bytes += chunk.length;
    if (bytes > 30000) { req.destroy(); return; }
  });
  res.on('close', () => {
    console.log('BYTES READ:', bytes);
    if (firstChunk) {
      console.log('FIRST 80 BYTES HEX:');
      console.log(firstChunk.slice(0, 80).toString('hex'));
      console.log('FIRST 80 BYTES TEXT:');
      console.log(firstChunk.slice(0, 80).toString('utf8').replace(/[^\x20-\x7E\n]/g, '.'));
    }
  });
});
req.on('error', (e) => console.log('ERR:', e.message));
req.end();
setTimeout(() => { try { req.destroy(); } catch(_){} }, 5000);
