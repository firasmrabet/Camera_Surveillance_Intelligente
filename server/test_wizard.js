/**
 * Generate a test JWT and run end-to-end tests of the Add Camera wizard endpoints
 */
const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const token = jwt.sign(
  { userId: '65f0000000000000000000aa', email: 'firasmrabet@gmail.com', role: 'user' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

function req(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost', port: 5000, path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data ? data.length : 0,
        'Authorization': `Bearer ${token}`
      }
    };
    const r = http.request(options, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch (e) { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  console.log('=== AUTH TOKEN ===');
  console.log('Generated JWT for firasmrabet@gmail.com\n');

  console.log('=== TEST 1: GET /api/cameras/presets ===');
  const presets = await req('GET', '/api/cameras/presets');
  console.log(`Status: ${presets.status}, presets: ${presets.body.presets?.length}, cloud: ${presets.body.cloudProviders?.length}`);

  console.log('\n=== TEST 2: GET /api/cameras/network-info ===');
  const netInfo = await req('GET', '/api/cameras/network-info');
  console.log(`Status: ${netInfo.status}, subnets: ${netInfo.body.subnets?.length}`);
  if (netInfo.body.subnets) {
    netInfo.body.subnets.forEach(s => console.log(`  - ${s.interface}: ${s.address} (${s.baseIp})`));
  }

  console.log('\n=== TEST 3: POST /api/cameras/scan-network (port 8080) ===');
  const start = Date.now();
  const scan = await req('POST', '/api/cameras/scan-network', { port: 8080 });
  console.log(`Status: ${scan.status}, ok: ${scan.body.ok}, devices: ${scan.body.devices?.length}, took: ${Date.now() - start}ms`);
  if (scan.body.devices) {
    scan.body.devices.forEach(d => console.log(`  - ${d.host}:${d.port} (${d.responseTime}ms)`));
  }

  console.log('\n=== TEST 4: POST /api/cameras/test-connection IP Webcam style ===');
  const test = await req('POST', '/api/cameras/test-connection', {
    protocol: 'mjpeg',
    host: 'http://192.168.100.165:8080',  // user pastes full URL
    port: null,
    path: '',
    snapshotPath: '/shot.jpg',
    vendor: 'ip_webcam_android',
    model: ''
  });
  console.log(`Status: ${test.status}`);
  console.log(`ok: ${test.body.ok}`);
  console.log(`error: ${test.body.error}`);
  console.log(`duration: ${test.body.duration_ms}ms`);
  if (test.body.diagnostics) {
    test.body.diagnostics.forEach(d => console.log(`  [${d.severity}] ${d.message}`));
  }

  console.log('\n=== TEST 5: POST /api/cameras/test-connection (with explicit port) ===');
  const test2 = await req('POST', '/api/cameras/test-connection', {
    protocol: 'mjpeg',
    host: '192.168.100.165',
    port: 8080,
    path: '/?action=stream',
    snapshotPath: '/shot.jpg',
    vendor: 'ip_webcam_android'
  });
  console.log(`Status: ${test2.status}, ok: ${test2.body.ok}, error: ${test2.body.error}`);

  console.log('\n=== TEST 6: POST /api/cameras/test-connection (PC self) ===');
  const test3 = await req('POST', '/api/cameras/test-connection', {
    protocol: 'mjpeg',
    host: '192.168.100.81',
    port: 8080,
    path: '/',
    snapshotPath: '/api/health'
  });
  console.log(`Status: ${test3.status}, ok: ${test3.body.ok}, error: ${test3.body.error}`);
  console.log(`snapshot: ${test3.body.snapshotUrl ? 'YES' : 'no'}`);

  console.log('\n=== ALL TESTS DONE ===');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
