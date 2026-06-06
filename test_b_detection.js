// Test B: Trigger AI detection manually and check for alerts
const http = require('http');
const fs = require('fs');

const TOKEN = fs.readFileSync('test_token.txt', 'utf8').trim();
const CAMERA_ID = 'cam-2bbe5ea7';

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 5000, path, method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN }
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(opts, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve(JSON.parse(text)); } catch { resolve(text); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log('=== Test B: AI Detection ===\n');

  // 1. Get current alerts
  let alerts = await api('GET', '/api/alerts');
  console.log('Alerts before:', Array.isArray(alerts) ? alerts.length : alerts);

  // 2. Force camera re-registration with detection enabled
  const cam = await api('GET', `/api/cameras/${CAMERA_ID}`);
  console.log('Camera:', cam.name, 'detectionEnabled:', cam.detectionEnabled);

  // 3. Toggle detection on then off then on to retrigger
  await api('PUT', `/api/cameras/${CAMERA_ID}`, { detectionEnabled: false });
  await new Promise(r => setTimeout(r, 1000));
  await api('PUT', `/api/cameras/${CAMERA_ID}`, { detectionEnabled: true });
  console.log('Re-toggled detectionEnabled to retrigger frame capture');

  // 4. Wait for detection to run for 15 seconds
  console.log('\nWaiting 15s for AI detection to process frames...');
  for (let i = 15; i > 0; i--) {
    process.stdout.write(`${i}s... `);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('\n');

  // 5. Check alerts again
  alerts = await api('GET', '/api/alerts');
  console.log('Alerts after:', Array.isArray(alerts) ? alerts.length : alerts);
  if (Array.isArray(alerts) && alerts.length > 0) {
    console.log('Latest alert:', JSON.stringify(alerts[0], null, 2));
  }
})();
