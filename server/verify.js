const http = require('http');
const fs = require('fs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const token = jwt.sign(
  { userId: '1b943332-007d-41bc-8748-461e3ac6c37a', email: 'prepamonastir112@gmail.com' },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

function req(path, opts = {}) {
  return new Promise((resolve) => {
    const r = http.request({ hostname: 'localhost', port: 5000, path, method: opts.method || 'GET', headers: opts.headers || {}, timeout: 5000 }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, error: 'TIMEOUT' }); });
    r.on('error', e => resolve({ status: 0, error: e.message }));
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

(async () => {
  console.log('=== Test 1: /api/cameras with valid token ===');
  const r1 = await req('/api/cameras', { headers: { Authorization: `Bearer ${token}` } });
  console.log('status:', r1.status, '| body:', r1.body.toString().substring(0, 200));

  console.log('\n=== Test 2: /api/cameras/cam-91473391/preview ===');
  const r2 = await req('/api/cameras/cam-91473391/preview', { headers: { Authorization: `Bearer ${token}` } });
  console.log('status:', r2.status, '| content-type:', r2.headers['content-type'], '| size:', r2.body.length, 'bytes');
  if (r2.body.length > 100) {
    fs.writeFileSync('C:\\Users\\Mrabet\\AppData\\Local\\Temp\\opencode\\preview_test.jpg', r2.body);
    const magic = `${r2.body[0].toString(16)} ${r2.body[1].toString(16)} ${r2.body[2].toString(16)}`;
    console.log('magic bytes:', magic, '| saved to preview_test.jpg');
  }

  console.log('\n=== Test 3: /api/cameras/cam-91473391/stream (first 2KB only) ===');
  const r3 = await new Promise((resolve) => {
    const r = http.request({ hostname: 'localhost', port: 5000, path: '/api/cameras/cam-91473391/stream', method: 'GET', headers: { Authorization: `Bearer ${token}` }, timeout: 5000 }, (res) => {
      const chunks = [];
      let total = 0;
      res.on('data', c => { total += c.length; chunks.push(c); if (total > 2048) { r.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }); } });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, error: 'TIMEOUT' }); });
    r.on('error', e => resolve({ status: 0, error: e.message }));
    r.end();
  });
  console.log('status:', r3.status, '| content-type:', r3.headers['content-type'], '| size:', r3.body.length);

  process.exit(0);
})();
