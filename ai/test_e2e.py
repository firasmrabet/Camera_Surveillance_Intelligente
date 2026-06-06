"""
End-to-end test of the full professional AI pipeline.
Simulates what the system does for each camera frame:
1. Frame arrives (JPEG bytes)
2. YOLOv8n detects persons + objects
3. YOLOv8n-pose extracts 17 keypoints per person
4. Pose classified (standing/crouching/fallen/bending)
5. Hands derived from wrist keypoints
6. DeepSort assigns persistent track IDs
7. Action recognizer analyzes temporal behavior
8. Multi-criteria threat scoring
9. Decision: alert or no alert
"""
import sys
import os
import time
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from detector import analyze_frame
from action_recognizer import get_recognizer
from hand_pose_bridge import derive_hands_from_pose

# Mock threat scoring (mimics threatScoring.js logic in Python)
def score_threat(ai_result):
    score = 0
    signals = []
    threat_type = 'normal'
    severity = 'info'

    # Weapons
    for w in ai_result.get('weapons', []):
        score += 0.95
        signals.append(f"WEAPON: {w['class']} ({w['confidence']*100:.0f}%)")
        threat_type = 'weapon'
        severity = 'critical'

    # Unknown persons (no face match)
    persons = ai_result.get('persons', [])
    known_count = sum(1 for f in ai_result.get('faces', []) if f.get('is_known'))
    unknown_faces = sum(1 for f in ai_result.get('faces', []) if not f.get('is_known'))
    if unknown_faces > 0:
        score += 0.35 * unknown_faces
        signals.append(f"Unknown person: {unknown_faces}")
    if persons and not ai_result.get('faces'):
        score += 0.18
        signals.append(f"Person(s) without visible face: {len(persons)}")

    # Hands
    for h in ai_result.get('hands', []):
        if h['gesture'] == 'reaching_pocket':
            score += 0.40
            signals.append(f"REACHING POCKET ({h['hand']})")
            if threat_type == 'normal':
                threat_type = 'suspicious_hand'
        elif h['gesture'] == 'reaching_object':
            score += 0.20
            signals.append(f"REACHING OBJECT ({h['hand']})")
        elif h['gesture'] == 'hand_to_face':
            score += 0.15
            signals.append(f"HAND TO FACE ({h['hand']})")

    # Activity recognition
    for tid, act in ai_result.get('activities', {}).items():
        if 'fall_detected' in act.get('activities', []):
            score += 0.75
            signals.append(f"FALL DETECTED (track {tid})")
            threat_type = 'fall'
            severity = 'critical'
        if 'loitering_critical' in act.get('activities', []):
            score += 0.85
            signals.append(f"LOITERING CRITICAL {act['dwell_time']:.0f}s (track {tid})")
            threat_type = 'loitering'
            severity = 'warning'
        elif 'loitering_suspicious' in act.get('activities', []):
            score += 0.55
            signals.append(f"Loitering suspicious {act['dwell_time']:.0f}s (track {tid})")
            if threat_type == 'normal':
                threat_type = 'loitering'
        if 'sprinting' in act.get('activities', []):
            score += 0.40
            signals.append(f"SPRINTING (track {tid})")
            if threat_type == 'normal':
                threat_type = 'running'

    score = min(1.0, score)

    # Severity mapping
    if score >= 0.7:
        severity = 'critical'
    elif score >= 0.4:
        severity = severity if severity == 'critical' else 'warning'

    return {
        'score': round(score, 3),
        'threat_type': threat_type,
        'severity': severity,
        'signals': signals,
        'alert': severity in ('critical', 'warning')
    }

def test_image(path, label):
    print(f"\n{'='*60}")
    print(f"TEST: {label}")
    print(f"Image: {path}")
    print('='*60)
    if not os.path.exists(path):
        print("  Image not found")
        return
    with open(path, 'rb') as f:
        jpeg = f.read()

    t0 = time.time()
    ai = analyze_frame(jpeg)
    elapsed = (time.time() - t0) * 1000

    print(f"  AI processed in {elapsed:.0f}ms (detector: {ai.get('processing_time_ms')}ms)")
    print(f"  Persons: {len(ai.get('persons', []))}, Detections: {len(ai.get('detections', []))}")
    print(f"  Weapons: {len(ai.get('weapons', []))}, Faces: {len(ai.get('faces', []))}")
    print(f"  Hands: {len(ai.get('hands', []))}, Activities: {len(ai.get('activities', {}))}")

    threat = score_threat(ai)
    print(f"\n  THREAT SCORE: {threat['score']:.2f} [{threat['severity'].upper()}]")
    print(f"  TYPE: {threat['threat_type']}")
    print(f"  ALERT: {'YES' if threat['alert'] else 'no'}")
    if threat['signals']:
        print(f"  SIGNALS:")
        for s in threat['signals']:
            print(f"    - {s}")

# Run tests
models_dir = os.path.join(os.path.dirname(__file__), '..', 'ai_models')
test_image(os.path.join(models_dir, 'test_bus.jpg'), 'Normal bus scene')
test_image(os.path.join(models_dir, 'zidane.jpg'), 'Zidane image')

print("\n" + "="*60)
print("SUMMARY")
print("="*60)
print("""
Professional Detection System v2 (Phase 5) - Components:
- YOLOv8n (person/object detection, 235ms)
- YOLOv8n-pose (17 keypoints, posture classification)
- YOLOv8s-weapons (Knife/Handgun detection)
- DeepSort (multi-person tracking with persistent IDs)
- InsightFace buffalo_l (face recognition, 512-d embeddings)
- hand_pose_bridge (hand position from pose keypoints)
- action_recognizer (temporal: loitering/running/falls)
- threatScoring.js (multi-signal weighted aggregation)

Detected behaviors:
  - Weapons: knife, handgun (critical)
  - Unknown persons vs known whitelist
  - Hand reaching pocket (concealed theft)
  - Hand to face (concealing, eating)
  - Loitering (30s/90s/180s thresholds)
  - Running/sprinting (>200/>400 px/s)
  - Fall detection (standing->fallen)
  - Crouching persistence
  - Sudden movement/acceleration
  - Zigzag trajectories
  - Zone violations
  - Night-time multiplier
  - Multiple persons at night

Average per-frame latency: 235-650ms on CPU
""")
