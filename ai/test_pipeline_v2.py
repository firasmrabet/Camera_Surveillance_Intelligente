"""Final end-to-end test of the AI pipeline with all Phase 5 features."""
import sys
import os
import json
import time
import asyncio
import base64

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from detector import analyze_frame
from action_recognizer import get_recognizer

# Load test image
test_image = os.path.join(os.path.dirname(__file__), '..', 'ai_models', 'test_bus.jpg')
with open(test_image, 'rb') as f:
    jpeg_bytes = f.read()

print(f"Image: {test_image} ({len(jpeg_bytes)/1024:.1f} KB)")
print("=" * 60)

# Simulate 10 frames to test temporal analysis
recognizer = get_recognizer()
print("\nSimulating 10 frames to test temporal analysis...")
all_results = []
for frame_idx in range(10):
    # Slightly perturb the image (simulate motion)
    t0 = time.time()
    result = analyze_frame(jpeg_bytes, known_faces=[], zones=[])
    elapsed = (time.time() - t0) * 1000
    print(f"Frame {frame_idx}: {result.get('processing_time_ms')}ms, "
          f"persons={len(result.get('persons', []))}, "
          f"hands={len(result.get('hands', []))}, "
          f"weapons={len(result.get('weapons', []))}, "
          f"faces={len(result.get('faces', []))}")
    all_results.append(result)

print(f"\n=== Final results from last frame ===")
last = all_results[-1]
print(json.dumps({
    'frame_size': last.get('frame_size'),
    'processing_time_ms': last.get('processing_time_ms'),
    'persons': [{'track_id': p['track_id'], 'bbox': [int(v) for v in p['bbox']], 'activity': p.get('activity', {}).get('activities', [])} for p in last.get('persons', [])],
    'hands_count': len(last.get('hands', [])),
    'weapons_count': len(last.get('weapons', [])),
    'faces_count': len(last.get('faces', [])),
    'activities': last.get('activities', {}),
    'poses': [{'track_id': p.get('track_id'), 'posture': p.get('posture'), 'gesture': p.get('gesture')} for p in last.get('poses', [])]
}, indent=2))
