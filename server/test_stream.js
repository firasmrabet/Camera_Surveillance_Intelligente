const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Generate JWT for test user
const token = jwt.sign(
  { id: '1b943332-007d-41bc-8748-461e3ac6c37a', email: 'prepamonastir112@gmail.com' },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);
console.log('JWT generated');

const streamReq = http.request({
  hostname: 'localhost', port: 5000, path: '/api/cameras/cam-91473391/stream',
  method: 'GET', headers: { Authorization: 'Bearer ' + token }
}, (sres) => {
  console.log('Stream status:', sres.statusCode);
  console.log('Content-Type:', sres.headers['content-type']);
  console.log('Cache-Control:', sres.headers['cache-control']);
  let bytes = 0;
  sres.on('data', c => { bytes += c.length; if (bytes > 3000) sres.destroy(); });
  sres.on('close', () => console.log('Stream closed after', bytes, 'bytes'));
  sres.on('end', () => console.log('Stream ended after', bytes, 'bytes'));
  setTimeout(() => { sres.destroy(); process.exit(0); }, 3000);
});
streamReq.on('error', e => console.log('Stream err:', e.message));
streamReq.end();
