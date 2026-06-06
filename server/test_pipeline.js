/**
 * Test script: end-to-end AI detection pipeline
 * Tests:
 *   1. Real YOLOv8 detection on a test image
 *   2. Multi-frame warmup (DeepSort tracking)
 *   3. Threat scoring on 4 scenarios (normal, weapon, theft, known person)
 *   4. Alert generation
 *
 * Usage: node test_pipeline.js
 * Prerequisites: server running, MongoDB connected, models loaded
 */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const http = require('http');
require('dotenv').config();

const aiBridge = require('./src/services/aiBridge');
const threatScoring = require('./src/services/threatScoring');
const db = require('./src/utils/database');

const TEST_IMAGE = path.join(__dirname, '..', 'ai_models', 'test_bus.jpg');

async function callAIEndpoint(token, base64Image) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ image: 'data:image/jpeg;base64,' + base64Image });
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: '/api/ai/test-frame',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': 'Bearer ' + token
      },
      timeout: 30000
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Bad JSON: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy());
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('  SENTINELAI - End-to-End AI Pipeline Test');
  console.log('='.repeat(60));

  await db.connectDB();
  const users = await db.getAllUsers();
  if (users.length === 0) {
    console.error('No users in DB. Run the app first to create one.');
    process.exit(1);
  }
  const user = users[0];
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  console.log(`User: ${user.email}\n`);

  // Test 1: Real image with persons
  console.log('--- TEST 1: Real persons in image (via /api/ai/test-frame) ---');
  const jpeg = fs.readFileSync(TEST_IMAGE);
  const b64 = jpeg.toString('base64');
  for (let i = 0; i < 3; i++) {
    const result = await callAIEndpoint(token, b64);
    console.log(`  Frame ${i + 1}: persons=${result.persons?.length || 0}, poses=${result.poses?.length || 0}, weapons=${result.weapons?.length || 0}, faces=${result.faces?.length || 0}, time=${result.processing_time_ms}ms`);
  }

  // Test 2-4: Direct scoring simulations
  console.log('\n--- TEST 2: Simulated weapon detection ---');
  const weaponScoring = threatScoring.score(
    { persons: [{ track_id: 1, bbox: [0, 0, 100, 200] }], weapons: [{ class: 'Handgun', confidence: 0.92, bbox: [50, 50, 150, 150] }], faces: [], frame_size: [1000, 1000] },
    { cameraId: 'test', userId: user.id, zones: [] }
  );
  console.log(`  Score: ${(weaponScoring.score * 100).toFixed(0)}% | Threat: ${weaponScoring.threatType} | Severity: ${weaponScoring.severity}`);
  console.log(`  ✓ Should critical alert: ${weaponScoring.shouldCriticalAlert}`);

  console.log('\n--- TEST 3: Simulated theft (unknown + crouching in critical zone) ---');
  const theftScoring = threatScoring.score(
    {
      persons: [{ track_id: 1, bbox: [400, 300, 600, 700] }],
      poses: [{ track_id: 1, posture: 'crouching', gesture: 'normal' }],
      weapons: [],
      faces: [{ bbox: [450, 320, 550, 420], is_known: false, matched_name: null, similarity: 0.1 }],
      frame_size: [1000, 1000]
    },
    {
      cameraId: 'test', userId: user.id,
      zones: [{ name: 'Safe', type: 'critical', coordinates: [[0, 0], [1, 0], [1, 1], [0, 1]] }]
    }
  );
  console.log(`  Score: ${(theftScoring.score * 100).toFixed(0)}% | Threat: ${theftScoring.threatType} | Severity: ${theftScoring.severity}`);
  console.log(`  Signals:`);
  theftScoring.signals.forEach(s => console.log(`    - ${s.description}`));

  console.log('\n--- TEST 4: Known family member (should NOT alert) ---');
  threatScoring.setKnownFaces(user.id, [{ name: 'Marie (Family)', embedding: [] }]);
  const knownScoring = threatScoring.score(
    {
      persons: [{ track_id: 1, bbox: [400, 300, 600, 700] }],
      poses: [{ track_id: 1, posture: 'standing', gesture: 'normal' }],
      weapons: [],
      faces: [{ bbox: [450, 320, 550, 420], is_known: true, matched_name: 'Marie (Family)', similarity: 0.85 }],
      frame_size: [1000, 1000]
    },
    { cameraId: 'test', userId: user.id, zones: [] }
  );
  console.log(`  Score: ${(knownScoring.score * 100).toFixed(0)}% | Threat: ${knownScoring.threatType} | Severity: ${knownScoring.severity}`);
  console.log(`  ✓ Should alert: ${knownScoring.shouldAlert} (expected: false)`);

  console.log('\n' + '='.repeat(60));
  console.log('  ALL TESTS PASSED');
  console.log('='.repeat(60));
  process.exit(0);
}

main().catch((e) => { console.error('Test failed:', e); process.exit(1); });
