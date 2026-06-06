// Test E: User isolation
const http = require('http');

function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 5000, path, method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(opts, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let parsed = text;
        try { parsed = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getOrCreateUser(email, password, name) {
  let r = await api('POST', '/api/auth/register', { email, password, name });
  if (r.status === 409) {
    r = await api('POST', '/api/auth/login', { email, password });
  }
  return r;
}

(async () => {
  console.log('=== Test E: User Isolation ===\n');

  // 1. Get or create Alice and Bob
  const r1 = await getOrCreateUser('alice@isolation.com', 'Alice1234!', 'Alice');
  const r2 = await getOrCreateUser('bob@isolation.com', 'Bob12345!', 'Bob');
  console.log('1. Alice:', r1.status, r1.data.user?.email);
  console.log('   Bob:  ', r2.status, r2.data.user?.email);
  const aliceToken = r1.data.token;
  const bobToken = r2.data.token;

  // 2. Alice creates a camera
  const aliceCam = await api('POST', '/api/cameras', {
    name: 'Alice-Private-Cam',
    location: 'Alice Room',
    url: 'http://192.168.100.165:8080',
    protocol: 'mjpeg',
    resolution: '1280x720',
    fps: 15
  }, aliceToken);
  const aliceCamId = aliceCam.data.id || aliceCam.data.camera?.id;
  console.log('2. Alice created camera:', aliceCamId, '(status', aliceCam.status, ')');

  // 3. Bob creates a camera
  const bobCam = await api('POST', '/api/cameras', {
    name: 'Bob-Private-Cam',
    location: 'Bob Room',
    url: 'http://192.168.100.165:8080',
    protocol: 'mjpeg',
    resolution: '1280x720',
    fps: 15
  }, bobToken);
  const bobCamId = bobCam.data.id || bobCam.data.camera?.id;
  console.log('3. Bob created camera:', bobCamId, '(status', bobCam.status, ')');

  // 4. Alice lists her cameras — should not include Bob's
  const aliceList = await api('GET', '/api/cameras', null, aliceToken);
  const aliceCamNames = Array.isArray(aliceList.data) ? aliceList.data.map(c => c.name) : [];
  console.log('4. Alice sees:', aliceCamNames);
  const aliceSeesBobs = aliceCamNames.includes('Bob-Private-Cam');
  console.log('   LEAK Alice→Bob?', aliceSeesBobs ? 'YES ❌' : 'NO ✓');

  // 5. Bob lists his cameras — should not include Alice's
  const bobList = await api('GET', '/api/cameras', null, bobToken);
  const bobCamNames = Array.isArray(bobList.data) ? bobList.data.map(c => c.name) : [];
  console.log('5. Bob sees:', bobCamNames);
  const bobSeesAlices = bobCamNames.includes('Alice-Private-Cam');
  console.log('   LEAK Bob→Alice?', bobSeesAlices ? 'YES ❌' : 'NO ✓');

  // 6. Bob tries to GET Alice's camera
  const bobGetAlice = await api('GET', `/api/cameras/${aliceCamId}`, null, bobToken);
  console.log('6. Bob GET Alice camera:', bobGetAlice.status, '(expect 403)');

  // 7. Bob tries to UPDATE Alice's camera
  const bobUpdateAlice = await api('PUT', `/api/cameras/${aliceCamId}`, { name: 'HACKED' }, bobToken);
  console.log('7. Bob UPDATE Alice camera:', bobUpdateAlice.status, '(expect 403)');

  // 8. Bob tries to DELETE Alice's camera
  const bobDeleteAlice = await api('DELETE', `/api/cameras/${aliceCamId}`, null, bobToken);
  console.log('8. Bob DELETE Alice camera:', bobDeleteAlice.status, '(expect 403)');

  // 9. Bob tries Alice's preview
  const bobPreview = await api('GET', `/api/cameras/${aliceCamId}/preview?token=${bobToken}`, null, bobToken);
  console.log('9. Bob preview Alice camera:', bobPreview.status, '(expect 403)');

  // 10. Bob alerts (should be 0)
  const bobAlerts = await api('GET', '/api/alerts', null, bobToken);
  console.log('10. Bob alerts:', bobAlerts.data.total ?? bobAlerts.data.alerts?.length, '(expect 0)');

  // 11. Bob photos (should be 0)
  const bobPhotos = await api('GET', '/api/photos', null, bobToken);
  console.log('11. Bob photos:', bobPhotos.data.total ?? bobPhotos.data.photos?.length, '(expect 0)');

  // 12. Alice can still access her own camera
  const aliceGet = await api('GET', `/api/cameras/${aliceCamId}`, null, aliceToken);
  console.log('12. Alice GET own camera:', aliceGet.status, aliceGet.data.name, '(expect Alice-Private-Cam)');

  // 13. Alice updates her own camera
  const aliceUpdate = await api('PUT', `/api/cameras/${aliceCamId}`, { name: 'Alice-Renamed' }, aliceToken);
  console.log('13. Alice UPDATE own camera:', aliceUpdate.status, '(expect 200)');

  // Summary
  console.log('\n=== Summary ===');
  const ok = !aliceSeesBobs && !bobSeesAlices &&
             bobGetAlice.status === 403 &&
             bobUpdateAlice.status === 403 &&
             bobDeleteAlice.status === 403 &&
             bobPreview.status === 403 &&
             aliceGet.status === 200 &&
             aliceUpdate.status === 200;
  console.log(ok ? '✅ ALL ISOLATION CHECKS PASSED' : '❌ SOME CHECKS FAILED');
})();
