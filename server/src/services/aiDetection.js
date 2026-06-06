const { logger } = require('../utils/logger');
const db = require('../utils/database');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const https = require('https');

class AIDetectionEngine {
  constructor(io) {
    this.io = io;
    this.isInitialized = false;
    this.previousFrames = new Map();
    this.alertCooldowns = new Map();
    this.personTracker = new Map();
    this.motionHistory = new Map();
    this.notifications = null;

    this.thresholds = {
      confidence: parseFloat(process.env.DETECTION_CONFIDENCE_THRESHOLD) || 0.6,
      loiteringTime: 30000,
      motionSensitivity: 0.3,
      suspiciousSpeed: 0.8,
      theftConfidence: 0.75
    };

    this.detectionTypes = {
      PERSON: 'person',
      INTRUSION: 'intrusion',
      LOITERING: 'loitering',
      THEFT: 'theft',
      VANDALISM: 'vandalism',
      UNUSUAL_BEHAVIOR: 'unusual_behavior',
      UNATTENDED_OBJECT: 'unattended_object',
      MOTION: 'motion',
      NORMAL_PRESENCE: 'normal_presence'
    };
  }

  setNotifications(notifications) {
    this.notifications = notifications;
  }

  async initialize() {
    this.isInitialized = true;
    logger.info('AI Detection Engine initialized (motion-based)');
  }

  async detect(frame, cameraId) {
    if (!this.isInitialized) return [];
    if (!frame || !frame.data) return [];

    const detections = [];
    try {
      const previousFrame = this.previousFrames.get(cameraId);

      const motionRegions = this._analyzeMotionPixels(frame.data, previousFrame, frame.width, frame.height);
      this.previousFrames.set(cameraId, Buffer.from(frame.data));

      const motionMagnitude = motionRegions.totalMotion;
      const hasMotion = motionMagnitude > this.thresholds.motionSensitivity;

      this._trackMotionHistory(cameraId, motionMagnitude, hasMotion);

      if (hasMotion && motionRegions.regions.length > 0) {
        const personDetections = this._clusterMotionToPersons(motionRegions, frame.width, frame.height);
        personDetections.forEach(person => {
          const personTracking = this._trackPerson(cameraId, person);

          const baseDetection = {
            type: this.detectionTypes.PERSON,
            confidence: person.confidence,
            boundingBox: person.boundingBox,
            timestamp: new Date().toISOString(),
            zone: person.zone,
            features: {
              posture: this._inferPosture(person),
              speed: personTracking.speed,
              direction: personTracking.direction,
              timeInScene: personTracking.timeInScene,
              size: person.size
            }
          };
          detections.push(baseDetection);

          const behaviorDetections = this._analyzeBehavior(person, personTracking, cameraId);
          detections.push(...behaviorDetections);
        });

        const intrusionDetection = await this._detectIntrusion(cameraId, motionRegions, motionMagnitude);
        if (intrusionDetection) detections.push(intrusionDetection);

        const theftDetection = await this._detectTheft(cameraId, motionRegions, motionMagnitude, personDetections);
        if (theftDetection) detections.push(theftDetection);
      }

      if (detections.length > 0) {
        // Filter low-confidence noisy detections server-side to reduce false positives.
        const alwaysPass = [this.detectionTypes.INTRUSION, this.detectionTypes.THEFT, this.detectionTypes.VANDALISM];
        const filtered = detections.filter(d => {
          if (!d) return false;
          if (alwaysPass.includes(d.type)) return true;
          const conf = typeof d.confidence === 'number' ? d.confidence : 1;
          return conf >= (this.thresholds.confidence || 0.6);
        });
        if (filtered.length === 0) {
          logger.info(`Detections suppressed for camera ${cameraId} (all below confidence ${this.thresholds.confidence})`);
        } else {
          this.io.to(`camera-${cameraId}`).emit('detections', {
            cameraId,
            detections: filtered,
            timestamp: new Date().toISOString()
          });
          await this._processAlerts(filtered, cameraId, frame);
        }
      }

      this._storeDetectionHistory(cameraId, detections);
    } catch (error) {
      logger.error(`Detection error for camera ${cameraId}:`, error.message);
    }

    return detections;
  }

  _analyzeMotionPixels(currentData, previousData, width, height) {
    const regions = [];
    let totalMotion = 0;
    let motionPixels = 0;

    if (!previousData || previousData.length !== currentData.length) {
      return { totalMotion: 0, regions: [], motionPixels: 0 };
    }

    const blockSize = 32;
    const blocksX = Math.floor(width / blockSize);
    const blocksY = Math.floor(height / blockSize);
    const blockMotions = [];

    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        let blockDiff = 0;
        let pixelCount = 0;
        const startX = bx * blockSize;
        const startY = by * blockSize;

        for (let py = 0; py < blockSize; py += 4) {
          for (let px = 0; px < blockSize; px += 4) {
            const idx = ((startY + py) * width + (startX + px)) * 3;
            if (idx + 2 >= currentData.length) continue;
            const dr = Math.abs(currentData[idx] - previousData[idx]);
            const dg = Math.abs(currentData[idx + 1] - previousData[idx + 1]);
            const db = Math.abs(currentData[idx + 2] - previousData[idx + 2]);
            blockDiff += (dr + dg + db) / 3;
            pixelCount++;
          }
        }

        const avgDiff = pixelCount > 0 ? blockDiff / pixelCount : 0;
        const normalizedMotion = Math.min(avgDiff / 60, 1);

        if (normalizedMotion > 0.15) {
          blockMotions.push({
            x: bx / blocksX,
            y: by / blocksY,
            w: 1 / blocksX,
            h: 1 / blocksY,
            intensity: normalizedMotion
          });
          totalMotion += normalizedMotion;
          motionPixels++;
        }
      }
    }

    totalMotion = blocksX * blocksY > 0 ? totalMotion / (blocksX * blocksY) : 0;
    const mergedRegions = this._mergeAdjacentBlocks(blockMotions);
    return { totalMotion, regions: mergedRegions, motionPixels };
  }

  _mergeAdjacentBlocks(blocks) {
    const regions = [];
    const visited = new Set();

    blocks.forEach((block, idx) => {
      if (visited.has(idx)) return;
      const cluster = [block];
      visited.add(idx);

      let changed = true;
      while (changed) {
        changed = false;
        blocks.forEach((b2, i2) => {
          if (visited.has(i2)) return;
          const isAdjacent = cluster.some(cb =>
            Math.abs(cb.x - b2.x) < 0.15 && Math.abs(cb.y - b2.y) < 0.15
          );
          if (isAdjacent) {
            cluster.push(b2);
            visited.add(i2);
            changed = true;
          }
        });
      }

      const minX = Math.min(...cluster.map(c => c.x));
      const minY = Math.min(...cluster.map(c => c.y));
      const maxX = Math.max(...cluster.map(c => c.x + c.w));
      const maxY = Math.max(...cluster.map(c => c.y + c.h));
      const avgIntensity = cluster.reduce((sum, c) => sum + c.intensity, 0) / cluster.length;

      regions.push({
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        intensity: avgIntensity,
        blockCount: cluster.length
      });
    });

    return regions.filter(r => r.width * r.height > 0.01 && r.blockCount >= 2);
  }

  _clusterMotionToPersons(motionRegions, width, height) {
    const persons = [];

    const personRegions = motionRegions.filter(r => {
      const aspect = r.height / Math.max(r.width, 0.01);
      const area = r.width * r.height;
      return area > 0.02 && area < 0.6 && aspect > 0.5 && aspect < 4;
    });

    personRegions.forEach((region, idx) => {
      const confidence = Math.min(0.6 + region.intensity * 0.4, 0.98);
      const size = region.width * region.height;
      persons.push({
        id: `motion-${idx}-${Date.now()}`,
        confidence,
        boundingBox: {
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height
        },
        zone: null,
        size,
        intensity: region.intensity
      });
    });

    return persons;
  }

  _trackMotionHistory(cameraId, motionMagnitude, hasMotion) {
    const history = this.motionHistory.get(cameraId) || [];
    history.push({ motion: motionMagnitude, hasMotion, timestamp: Date.now() });
    if (history.length > 200) history.shift();
    this.motionHistory.set(cameraId, history);
  }

  _trackPerson(cameraId, person) {
    const trackKey = `${cameraId}_${person.boundingBox.x.toFixed(2)}_${person.boundingBox.y.toFixed(2)}`;
    const now = Date.now();

    const existing = Array.from(this.personTracker.entries()).find(([key, data]) => {
      if (key.startsWith(cameraId)) {
        const dx = Math.abs(data.lastPosition.x - person.boundingBox.x);
        const dy = Math.abs(data.lastPosition.y - person.boundingBox.y);
        return dx < 0.1 && dy < 0.1 && (now - data.lastSeen) < 3000;
      }
      return false;
    });

    if (existing) {
      const [key, tracking] = existing;
      const dt = (now - tracking.lastSeen) / 1000;
      const dx = person.boundingBox.x - tracking.lastPosition.x;
      const dy = person.boundingBox.y - tracking.lastPosition.y;
      const speed = dt > 0 ? Math.sqrt(dx * dx + dy * dy) / dt : 0;
      const direction = Math.atan2(dy, dx) * 180 / Math.PI;

      tracking.positions.push({ ...person.boundingBox, timestamp: now, speed });
      if (tracking.positions.length > 50) tracking.positions.shift();
      tracking.lastPosition = person.boundingBox;
      tracking.lastSeen = now;
      tracking.speed = speed;
      tracking.direction = direction;
      tracking.timeInScene = now - tracking.enteredAt;

      this.personTracker.set(key, tracking);
      return tracking;
    } else {
      const newTracking = {
        cameraId,
        enteredAt: now,
        lastSeen: now,
        positions: [{ ...person.boundingBox, timestamp: now, speed: 0 }],
        lastPosition: person.boundingBox,
        speed: 0,
        direction: 0,
        timeInScene: 0
      };
      this.personTracker.set(trackKey, newTracking);
      return newTracking;
    }
  }

  _inferPosture(person) {
    const aspect = person.boundingBox.height / Math.max(person.boundingBox.width, 0.01);
    if (aspect > 2.2) return 'standing';
    if (aspect > 1.5) return 'walking';
    if (aspect > 1.0) return 'bending';
    return 'crouching';
  }

  _analyzeBehavior(person, tracking, cameraId) {
    const detections = [];
    const isNightTime = this._isNightTime();

    if (tracking.timeInScene > 15000) {
      const movementVariance = this._calculateMovementVariance(tracking.positions);
      if (movementVariance < 0.005 && tracking.positions.length > 10) {
        detections.push({
          type: this.detectionTypes.LOITERING,
          confidence: 0.8,
          personId: person.id,
          duration: tracking.timeInScene,
          timestamp: new Date().toISOString(),
          zone: person.zone,
          severity: 'warning',
          details: { pattern: 'stationary', duration: tracking.timeInScene, isNight: isNightTime }
        });
      }
    }

    let behaviorScore = 0;
    const factors = [];

    if (tracking.speed > 0.5) {
      behaviorScore += 0.25;
      factors.push('rapid_movement');
    }
    if (tracking.speed > 0.8) {
      behaviorScore += 0.2;
      factors.push('running');
    }

    if (person.features.posture === 'crouching' || person.features.posture === 'bending') {
      behaviorScore += 0.3;
      factors.push('low_posture');
    }

    const directionChanges = this._countDirectionChanges(tracking.positions);
    if (directionChanges > 4 && tracking.positions.length > 8) {
      behaviorScore += 0.25;
      factors.push('erratic_path');
    }

    if (isNightTime) {
      behaviorScore += 0.15;
      factors.push('night_time');
    }

    const backAndForth = this._detectBackAndForth(tracking.positions);
    if (backAndForth) {
      behaviorScore += 0.3;
      factors.push('suspicious_pacing');
    }

    if (behaviorScore > 0.6) {
      detections.push({
        type: this.detectionTypes.UNUSUAL_BEHAVIOR,
        confidence: Math.min(behaviorScore, 0.95),
        personId: person.id,
        timestamp: new Date().toISOString(),
        zone: person.zone,
        severity: behaviorScore > 0.8 ? 'critical' : 'warning',
        details: { score: behaviorScore, factors, posture: person.features.posture, speed: tracking.speed }
      });
    }

    return detections;
  }

  async _detectIntrusion(cameraId, motionRegions, motionMagnitude) {
    const camera = await db.getCameraById(cameraId);
    if (!camera || !camera.zones || camera.zones.length === 0) return null;

    const criticalZones = camera.zones.filter(z => z.type === 'critical');
    if (criticalZones.length === 0) return null;

    for (const region of motionRegions) {
      const centerX = region.x + region.width / 2;
      const centerY = region.y + region.height / 2;
      for (const zone of criticalZones) {
        if (this._isPointInZone(centerX, centerY, zone.coordinates)) {
          return {
            type: this.detectionTypes.INTRUSION,
            confidence: Math.min(0.7 + region.intensity * 0.3, 0.98),
            timestamp: new Date().toISOString(),
            zone: { name: zone.name, type: zone.type },
            severity: 'critical',
            details: { motionMagnitude, region }
          };
        }
      }
    }
    return null;
  }

  async _detectTheft(cameraId, motionRegions, motionMagnitude, persons) {
    const camera = await db.getCameraById(cameraId);
    if (!camera) return null;

    const isNightTime = this._isNightTime();
    let theftScore = 0;
    const factors = [];

    if (persons.length === 1 && persons[0].features.posture === 'crouching') {
      theftScore += 0.3;
      factors.push('crouching_posture');
    }

    if (motionMagnitude > 0.4 && motionMagnitude < 0.8) {
      theftScore += 0.2;
      factors.push('deliberate_motion');
    }

    if (isNightTime) {
      theftScore += 0.2;
      factors.push('unusual_hour');
    }

    const recentMotions = this.motionHistory.get(cameraId) || [];
    if (recentMotions.length > 5) {
      const motionTrend = recentMotions.slice(-5).map(m => m.motion);
      const variance = this._calculateArrayVariance(motionTrend);
      if (variance > 0.05 && motionTrend.some(m => m > 0.3)) {
        theftScore += 0.25;
        factors.push('intermittent_activity');
      }
    }

    if (theftScore > this.thresholds.theftConfidence) {
      return {
        type: this.detectionTypes.THEFT,
        confidence: Math.min(theftScore, 0.95),
        timestamp: new Date().toISOString(),
        zone: persons[0]?.zone || { name: 'Monitored Area', type: 'critical' },
        severity: 'critical',
        details: { factors, motionMagnitude, posture: persons[0]?.features?.posture }
      };
    }
    return null;
  }

  _isNightTime() {
    const hour = new Date().getHours();
    return hour < 6 || hour > 22;
  }

  _calculateMovementVariance(positions) {
    if (positions.length < 3) return 0;
    const xs = positions.map(p => p.x);
    const ys = positions.map(p => p.y);
    return this._calculateArrayVariance(xs) + this._calculateArrayVariance(ys);
  }

  _calculateArrayVariance(arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
  }

  _countDirectionChanges(positions) {
    if (positions.length < 3) return 0;
    let changes = 0;
    let lastDx = 0;
    for (let i = 1; i < positions.length; i++) {
      const dx = positions[i].x - positions[i - 1].x;
      if (lastDx !== 0 && Math.sign(dx) !== Math.sign(lastDx) && Math.abs(dx) > 0.005) {
        changes++;
      }
      lastDx = dx;
    }
    return changes;
  }

  _detectBackAndForth(positions) {
    if (positions.length < 6) return false;
    const recent = positions.slice(-8);
    const xValues = recent.map(p => p.x);
    const min = Math.min(...xValues);
    const max = Math.max(...xValues);
    const range = max - min;
    if (range < 0.05) return false;
    let directionChanges = 0;
    for (let i = 1; i < xValues.length; i++) {
      if (Math.sign(xValues[i] - xValues[i - 1]) !== Math.sign(xValues[i - 1] - (xValues[i - 2] || xValues[i - 1]))) {
        directionChanges++;
      }
    }
    return directionChanges >= 3;
  }

  _isPointInZone(x, y, coordinates) {
    if (!coordinates || coordinates.length < 3) return false;
    let inside = false;
    for (let i = 0, j = coordinates.length - 1; i < coordinates.length; j = i++) {
      const xi = coordinates[i][0], yi = coordinates[i][1];
      const xj = coordinates[j][0], yj = coordinates[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  async _captureAlertFrame(cameraId) {
    try {
      const camera = await db.getCameraById(cameraId);
      if (!camera || !camera.url) return null;

      const baseUrl = camera.url.replace(/\/$/, '');
      const paths = ['/shot.jpg', '/snapshot', '/jpeg', '/?action=snapshot'];
      for (const path of paths) {
        const snapshotUrl = baseUrl + path;
        const protocol = snapshotUrl.startsWith('https') ? https : http;
        const buffer = await new Promise((resolve) => {
          const req = protocol.get(snapshotUrl, { timeout: 3000 }, (res) => {
            if (res.statusCode !== 200) { resolve(null); return; }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', () => resolve(null));
          });
          req.on('error', () => resolve(null));
          req.on('timeout', () => { req.destroy(); resolve(null); });
        });
        if (buffer && buffer.length > 1000) return buffer.toString('base64');
      }
      return null;
    } catch (error) {
      logger.error(`Failed to capture frame for camera ${cameraId}:`, error.message);
      return null;
    }
  }

  async _processAlerts(detections, cameraId, frame) {
    const criticalDetections = detections.filter(d =>
      d.type === this.detectionTypes.INTRUSION ||
      d.type === this.detectionTypes.THEFT ||
      d.type === this.detectionTypes.VANDALISM ||
      (d.type === this.detectionTypes.UNUSUAL_BEHAVIOR && d.severity === 'critical')
    );

    if (criticalDetections.length === 0) return;

    const sortedCritical = criticalDetections.sort((a, b) => {
      const severityOrder = { critical: 3, warning: 2, info: 1 };
      return (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
    });

    const topDetection = sortedCritical[0];
    const cooldownKey = `${cameraId}_${topDetection.type}`;
    const lastAlert = this.alertCooldowns.get(cooldownKey);
    const cooldownMs = (parseInt(process.env.ALERT_COOLDOWN_SECONDS) || 30) * 1000;
    if (lastAlert && (Date.now() - lastAlert) < cooldownMs) return;

    const camera = await db.getCameraById(cameraId);
    if (!camera) return;

    const alertCount = await db.getRecentAlertCount(camera.ownerId, 60);
    const maxAlerts = parseInt(process.env.MAX_ALERTS_PER_HOUR) || 20;
    if (alertCount >= maxAlerts) return;

    let frameBase64 = null;
    if (frame && frame.jpeg) {
      frameBase64 = frame.jpeg.toString('base64');
    } else if (frame && frame.data) {
      frameBase64 = frame.data.toString('base64');
    } else {
      frameBase64 = await this._captureAlertFrame(cameraId);
    }

    const alert = await db.createAlert({
      cameraId,
      ownerId: camera.ownerId,
      type: topDetection.type,
      severity: topDetection.severity || 'warning',
      confidence: topDetection.confidence,
      details: topDetection,
      frameBase64
    });

    this.alertCooldowns.set(cooldownKey, Date.now());
    this.io.to(`camera-${cameraId}`).emit('alert', alert);
    if (this.notifications) this.notifications.emitAlertToOwner(alert);

    if (this.notifications) {
      this.notifications.sendAlert(alert, frameBase64);
    }

    logger.info(`Alert created: ${alert.type} for camera ${cameraId} (confidence: ${(topDetection.confidence * 100).toFixed(0)}%)`);
  }

  _storeDetectionHistory(cameraId, detections) {
    const history = this.detectionHistory.get(cameraId) || [];
    history.push({ timestamp: Date.now(), detections: detections.length });
    if (history.length > 1000) history.shift();
    this.detectionHistory.set(cameraId, history);
  }

  updateThresholds(newThresholds) {
    this.thresholds = { ...this.thresholds, ...newThresholds };
  }
}

function initializeAIDetection(io) {
  const engine = new AIDetectionEngine(io);
  engine.initialize();
  return engine;
}

module.exports = { AIDetectionEngine, initializeAIDetection };
