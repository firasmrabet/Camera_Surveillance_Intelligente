/**
 * Multi-criteria Threat Scoring Engine
 * Combines outputs from YOLOv8 (person/object), pose, weapons, faces, zones, time-of-day
 * to produce a single threat score (0-1) and identify the most likely threat type.
 *
 * Goal: minimize false positives (e.g. family member walking) and false negatives
 * (e.g. thief in dark zone) by combining independent signals.
 */
const { logger } = require('../utils/logger');

class ThreatScoringEngine {
  constructor() {
    this.weights = {
      unknownPerson: 0.35,
      weaponDetected: 0.55,        // Reduced: cross-validated by COCO in Python, multi-frame confirmed in JS
      forbiddenZone: 0.40,
      nightTime: 0.20,
      suspiciousPosture: 0.25,
      handsRaised: 0.30,
      crouched: 0.20,
      movementInZone: 0.25,
      loitering: 0.30,
      bagObject: 0.10,
      multiplePersons: 0.15,
      // New: hand-based gestures (concealed theft)
      reachingPocket: 0.40,
      reachingObject: 0.20,
      handToFace: 0.15,
      // New: action recognition (temporal)
      fallDetected: 0.75,
      loiteringCritical: 0.85,
      loiteringSuspicious: 0.55,
      sprinting: 0.40,
      suddenMovement: 0.30,
      zigzag: 0.25,
      persistentCrouching: 0.30,
      // New: object context
      abandonedObject: 0.50
    };
    // Suspicious postures that combined with context indicate theft
    this.theftPronePostures = new Set(['crouching', 'bending', 'fallen']);
    this.suspiciousGestures = new Set(['hands_raised', 'one_hand_raised']);
    // Suspicious hand gestures
    this.suspiciousHandGestures = new Set(['reaching_pocket', 'reaching_object', 'hand_to_face']);
    this.threatHistory = new Map(); // cameraId -> array of recent events
    this.knownFacesCache = new Map(); // userId -> known faces
  }

  setKnownFaces(userId, faces) {
    this.knownFacesCache.set(userId, faces);
  }

  score(aiResult, context) {
    const { persons = [], poses = [], weapons = [], faces = [], hands = [], activities = {}, zones = [], frame_size } = aiResult;
    const { cameraId, userId, zones: dbZones = [] } = context || {};
    const hour = new Date().getHours();
    const isNight = hour < 6 || hour > 22;
    const knownFaces = this.knownFacesCache.get(userId) || [];

    const signals = [];
    let score = 0;
    let threatType = 'normal';
    let severity = 'info';
    let loitering = null;

    // 1) WEAPON DETECTION — highest priority
    if (weapons.length > 0) {
      const weapon = weapons[0];
      score += this.weights.weaponDetected;
      signals.push({
        type: 'weapon',
        class: weapon.class,
        confidence: weapon.confidence,
        bbox: weapon.bbox,
        weight: this.weights.weaponDetected,
        description: `Arme détectée: ${weapon.class} (${(weapon.confidence * 100).toFixed(0)}%)`
      });
      threatType = 'weapon_detected';
      severity = 'critical';
    }

    // 1b) HAND GESTURE ANALYSIS (concealed theft, grabbing motions)
    const suspiciousHands = (hands || []).filter(h => this.suspiciousHandGestures.has(h.gesture));
    if (suspiciousHands.length > 0) {
      // Weight by gesture type
      const hasReachingPocket = suspiciousHands.some(h => h.gesture === 'reaching_pocket');
      const hasReachingObject = suspiciousHands.some(h => h.gesture === 'reaching_object');
      const hasHandToFace = suspiciousHands.some(h => h.gesture === 'hand_to_face');

      if (hasReachingPocket) {
        score += this.weights.reachingPocket;
        signals.push({
          type: 'reaching_pocket',
          count: suspiciousHands.filter(h => h.gesture === 'reaching_pocket').length,
          weight: this.weights.reachingPocket,
          description: `Main près de la poche/hanche (vol dissimulé?)`
        });
        if (threatType === 'normal') threatType = 'suspicious_hand';
      }
      if (hasReachingObject) {
        score += this.weights.reachingObject;
        signals.push({
          type: 'reaching_object',
          count: suspiciousHands.filter(h => h.gesture === 'reaching_object').length,
          weight: this.weights.reachingObject,
          description: `Main tendue vers un objet (saisie?)`
        });
      }
      if (hasHandToFace) {
        score += this.weights.handToFace;
        signals.push({
          type: 'hand_to_face',
          count: suspiciousHands.filter(h => h.gesture === 'hand_to_face').length,
          weight: this.weights.handToFace,
          description: `Main près du visage (manger/concealer)`
        });
      }
    }

    // 1c) TEMPORAL ACTION RECOGNITION (loitering, running, falls)
    for (const [tid, activity] of Object.entries(activities || {})) {
      if (activity.threat_score > 0) {
        // Map activity signals to weighted contributions
        if (activity.signals.loitering_critical) {
          score += this.weights.loiteringCritical;
          signals.push({
            type: 'loitering_critical',
            track_id: tid,
            dwell: activity.dwell_time,
            weight: this.weights.loiteringCritical,
            description: `Présence anormale depuis ${Math.round(activity.dwell_time)}s`
          });
          threatType = 'loitering';
          if (severity === 'info') severity = 'warning';
        } else if (activity.signals.loitering_suspicious) {
          score += this.weights.loiteringSuspicious;
          signals.push({
            type: 'loitering_suspicious',
            track_id: tid,
            dwell: activity.dwell_time,
            weight: this.weights.loiteringSuspicious,
            description: `Présence prolongée ${Math.round(activity.dwell_time)}s`
          });
          if (threatType === 'normal') threatType = 'loitering';
        } else if (activity.signals.loitering) {
          score += this.weights.loitering;
          signals.push({
            type: 'loitering',
            track_id: tid,
            dwell: activity.dwell_time,
            weight: this.weights.loitering,
            description: `Présence ${Math.round(activity.dwell_time)}s`
          });
        }
        if (activity.signals.fall_detected) {
          score += this.weights.fallDetected;
          signals.push({
            type: 'fall_detected',
            track_id: tid,
            weight: this.weights.fallDetected,
            description: `Chute détectée (médical/attaque?)`
          });
          threatType = 'fall';
          severity = 'critical';
        }
        if (activity.signals.sprinting) {
          score += this.weights.sprinting;
          signals.push({
            type: 'sprinting',
            track_id: tid,
            speed: Math.round(activity.speed),
            weight: this.weights.sprinting,
            description: `Course détectée (${Math.round(activity.speed)} px/s)`
          });
          if (threatType === 'normal') threatType = 'running';
        }
        if (activity.signals.sudden_movement) {
          score += this.weights.suddenMovement;
          signals.push({
            type: 'sudden_movement',
            track_id: tid,
            accel: Math.round(activity.acceleration),
            weight: this.weights.suddenMovement,
            description: `Mouvement brusque (accélération ${Math.round(activity.acceleration)} px/s²)`
          });
        }
        if (activity.signals.zigzag) {
          score += this.weights.zigzag;
          signals.push({
            type: 'zigzag',
            track_id: tid,
            curvature: Math.round(activity.curvature * 10) / 10,
            weight: this.weights.zigzag,
            description: `Trajectoire en zigzag (curvature ${(activity.curvature).toFixed(1)})`
          });
        }
        if (activity.signals.persistent_crouching) {
          score += this.weights.persistentCrouching;
          signals.push({
            type: 'persistent_crouching',
            track_id: tid,
            weight: this.weights.persistentCrouching,
            description: `Personne accroupie depuis un moment`
          });
        }
      }
    }

    // 2) PERSON ANALYSIS (with face recognition + pose)
    const unknownPersons = [];
    const knownPersons = [];
    for (const face of faces) {
      if (face.is_known) {
        knownPersons.push(face);
      } else {
        unknownPersons.push(face);
        score += this.weights.unknownPerson;
        signals.push({
          type: 'unknown_person',
          name: face.matched_name || 'Inconnu',
          similarity: face.similarity,
          bbox: face.bbox,
          weight: this.weights.unknownPerson,
          description: `Personne inconnue détectée (similarité max: ${(face.similarity * 100).toFixed(0)}%)`
        });
      }
    }

    // If persons detected but no face visible, treat as unknown
    if (persons.length > 0 && faces.length === 0) {
      score += this.weights.unknownPerson * 0.5;
      signals.push({
        type: 'person_no_face',
        count: persons.length,
        weight: this.weights.unknownPerson * 0.5,
        description: `${persons.length} personne(s) sans visage visible (masque possible?)`
      });
    }

    // 3) POSE / GESTURE ANALYSIS
    for (const pose of poses) {
      if (this.theftPronePostures.has(pose.posture)) {
        score += this.weights.crouched;
        signals.push({
          type: 'suspicious_posture',
          posture: pose.posture,
          track_id: pose.track_id,
          weight: this.weights.crouched,
          description: `Posture suspecte: ${pose.posture}`
        });
      }
      if (this.suspiciousGestures.has(pose.gesture)) {
        score += this.weights.handsRaised;
        signals.push({
          type: 'suspicious_gesture',
          gesture: pose.gesture,
          track_id: pose.track_id,
          weight: this.weights.handsRaised,
          description: `Geste suspect: ${pose.gesture}`
        });
      }
    }

    // 4) ZONE VIOLATION
    const zoneViolations = this._checkZoneViolations(persons, poses, dbZones);
    for (const violation of zoneViolations) {
      score += this.weights.forbiddenZone;
      signals.push({
        type: 'zone_violation',
        zone: violation.zone,
        track_id: violation.track_id,
        weight: this.weights.forbiddenZone,
        description: `Personne dans la zone interdite: ${violation.zone.name}`
      });
    }

    // 5) NIGHTTIME — multiplies threat
    if (isNight && persons.length > 0) {
      score += this.weights.nightTime;
      signals.push({
        type: 'nighttime',
        weight: this.weights.nightTime,
        description: `Activité détectée la nuit (${hour}h)`
      });
    }

    // 6) LOITERING DETECTION (history-based)
    if (cameraId) {
      loitering = this._checkLoitering(cameraId, persons);
      if (loitering) {
        score += this.weights.loitering;
        signals.push({
          type: 'loitering',
          duration: loitering.duration,
          weight: this.weights.loitering,
          description: `Présence prolongée: ${(loitering.duration / 1000).toFixed(0)}s dans la même zone`
        });
      }
    }

    // 7) MULTIPLE PERSONS (could be group theft)
    if (persons.length >= 2 && isNight) {
      score += this.weights.multiplePersons;
      signals.push({
        type: 'multiple_persons',
        count: persons.length,
        weight: this.weights.multiplePersons,
        description: `${persons.length} personnes la nuit (groupe suspect?)`
      });
    }

    // 8) SUPPRESS SCORE for known persons (white-list)
    if (knownPersons.length > 0 && persons.length > 0 && unknownPersons.length === 0) {
      // All persons recognized
      const allKnown = persons.length <= knownPersons.length;
      if (allKnown) {
        score = Math.max(0, score - this.weights.unknownPerson * 2);
        signals.push({
          type: 'all_known',
          description: 'Toutes les personnes sont reconnues (famille/employé)'
        });
      }
    }

    // Normalize
    score = Math.min(score, 1.0);

    // Determine threat type from signals
    if (weapons.length > 0) {
      threatType = 'weapon_detected';
      severity = 'critical';
    } else if (zoneViolations.length > 0 && unknownPersons.length > 0) {
      threatType = 'intrusion';
      severity = score > 0.7 ? 'critical' : 'warning';
    } else if (unknownPersons.length > 0 && score > 0.5) {
      // Check if theft-prone
      const hasTheftPosture = poses && poses.some ? poses.some(p => this.theftPronePostures.has(p.posture)) : false;
      if (hasTheftPosture && (isNight || zoneViolations.length > 0)) {
        threatType = 'theft';
        severity = 'critical';
      } else {
        threatType = 'unknown_person';
        severity = score > 0.7 ? 'critical' : 'warning';
      }
    } else if (loitering && score > 0.5) {
      threatType = 'loitering';
      severity = 'warning';
    } else if (poses && poses.some && poses.some(p => this.suspiciousGestures.has(p.gesture)) && score > 0.4) {
      threatType = 'suspicious_behavior';
      severity = 'warning';
    } else if (score > 0.6) {
      threatType = 'suspicious_activity';
      severity = 'warning';
    }

    if (score > 0.85) severity = 'critical';
    else if (score > 0.65 && severity !== 'critical') severity = 'warning';

    return {
      score,
      threatType,
      severity,
      signals,
      // EXPANDED ALERT CRITERIA
      // Alert on:
      // 1) Weapons + persons
      // 2) Fall detected (medical emergency)
      // 3) Intrusion (unknown person in critical zone, high score)
      // 4) Theft / Suspicious Behavior / Loitering with high score
      // 5) Unknown person at night with high score
      shouldAlert: (weapons.length > 0 && persons.length > 0 && score > 0.75) ||
                   (activities && Object.values(activities).some(a => a.signals && a.signals.fall_detected)) ||
                   (threatType === 'intrusion' && score > 0.70) ||
                   (threatType === 'theft' && score > 0.70) ||
                   (threatType === 'suspicious_behavior' && score > 0.75) ||
                   (threatType === 'loitering' && score > 0.80) ||
                   (threatType === 'unknown_person' && isNight && score > 0.70) ||
                   (threatType === 'suspicious_activity' && score > 0.70) ||
                   (threatType === 'running' && score > 0.65) ||
                   (score > 0.85),
      shouldCriticalAlert: (weapons.length > 0 && persons.length > 0 && score > 0.90) ||
                           (activities && Object.values(activities).some(a => a.signals && a.signals.fall_detected)) ||
                           (threatType === 'intrusion' && score > 0.85) ||
                           (threatType === 'theft' && score > 0.85) ||
                           (score > 0.92),
      summary: this._buildSummary(threatType, score, signals),
      isNight,
      personCount: persons.length,
      unknownCount: unknownPersons.length,
      knownCount: knownPersons.length,
      weaponCount: weapons.length
    };
  }

  _checkZoneViolations(persons, poses, dbZones) {
    if (!dbZones || dbZones.length === 0) return [];
    const violations = [];
    for (const person of persons) {
      const cx = (person.bbox[0] + person.bbox[2]) / 2;
      const cy = (person.bbox[1] + person.bbox[3]) / 2;
      const [w, h] = [1, 1]; // normalized 0-1
      const normX = cx / w;
      const normY = cy / h;
      for (const zone of dbZones) {
        if (zone.type === 'critical' && this._isPointInZone(normX, normY, zone.coordinates)) {
          violations.push({ track_id: person.track_id, zone });
        }
      }
    }
    return violations;
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

  _checkLoitering(cameraId, persons) {
    if (!persons.length) return null;
    const now = Date.now();
    const history = this.threatHistory.get(cameraId) || [];
    history.push({ time: now, persons: persons.map(p => p.track_id) });
    if (history.length > 50) history.shift();
    this.threatHistory.set(cameraId, history);

    // Check if same track_id has been present for > 20s
    for (const person of persons) {
      const tid = person.track_id;
      const firstSeen = history.find(h => h.persons.includes(tid));
      if (firstSeen) {
        const duration = now - firstSeen.time;
        if (duration > 20000) return { track_id: tid, duration };
      }
    }
    return null;
  }

  _buildSummary(threatType, score, signals) {
    const lines = [];
    lines.push(`Menace: ${threatType} (score: ${(score * 100).toFixed(0)}%)`);
    for (const s of signals.slice(0, 5)) {
      lines.push(`- ${s.description}`);
    }
    return lines.join('\n');
  }

  updateWeights(newWeights) {
    this.weights = { ...this.weights, ...newWeights };
  }

  clearHistory(cameraId) {
    if (cameraId) this.threatHistory.delete(cameraId);
    else this.threatHistory.clear();
  }
}

module.exports = new ThreatScoringEngine();
