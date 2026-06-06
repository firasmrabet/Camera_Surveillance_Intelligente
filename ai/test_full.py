"""Full end-to-end test of the AI pipeline with hand detection."""
import sys
import os
import json
import time

# Add ai directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from detector import analyze_frame

# Load test image
test_image = os.path.join(os.path.dirname(__file__), '..', 'ai_models', 'test_bus.jpg')
with open(test_image, 'rb') as f:
    jpeg_bytes = f.read()

print(f"Image: {test_image} ({len(jpeg_bytes)/1024:.1f} KB)")
print("Running full analysis...")

t0 = time.time()
result = analyze_frame(jpeg_bytes)
t1 = time.time()

print(f"\nTotal time: {(t1-t0)*1000:.0f}ms (detector reported: {result.get('processing_time_ms')}ms)")
print(f"\n=== Results ===")
print(f"Persons: {len(result.get('persons', []))}")
for p in result.get('persons', []):
    print(f"  track_id={p['track_id']} bbox={[int(v) for v in p['bbox']]}")

print(f"\nDetections (non-person):")
for d in result.get('detections', []):
    if d['class'] != 'person':
        print(f"  {d['class']} {d['confidence']*100:.0f}% bbox={[int(v) for v in d['bbox']]}")

print(f"\nPoses:")
for pose in result.get('poses', []):
    print(f"  track_id={pose.get('track_id')} posture={pose.get('posture')} gesture={pose.get('gesture')}")

print(f"\nWeapons: {len(result.get('weapons', []))}")
for w in result.get('weapons', []):
    print(f"  {w['class']} {w['confidence']*100:.0f}%")

print(f"\nFaces: {len(result.get('faces', []))}")
for f in result.get('faces', []):
    print(f"  is_known={f['is_known']} matched={f.get('matched_name')} sim={f.get('similarity', 0):.2f}")

print(f"\nHands: {len(result.get('hands', []))}")
for h in result.get('hands', []):
    print(f"  {h['hand']}: {h['gesture']} at ({h['center'][0]:.0f},{h['center'][1]:.0f}) source={h.get('source', 'mediapipe')}")
