"""
Test the temporal action recognizer with simulated multi-frame video.
Demonstrates that the system properly detects loitering, running, and falls over time.
"""
import sys
import os
import time
import math
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from action_recognizer import get_recognizer

def make_fake_persons(n, base_x, base_y, dx=0, dy=0, posture='standing', gesture='normal'):
    return [
        {
            'track_id': i + 1,
            'bbox': [base_x + i*100 + dx, base_y + dy, base_x + i*100 + dx + 60, base_y + dy + 120]
        }
        for i in range(n)
    ]

def make_fake_poses(n, posture='standing', gesture='normal'):
    return [{'track_id': i+1, 'posture': posture, 'gesture': gesture} for i in range(n)]

rec = get_recognizer()

print("=" * 60)
print("TEST 1: LOITERING (person stays in one place)")
print("=" * 60)
# Person stands at (300, 400) for 100 simulated frames
for frame in range(100):
    persons = make_fake_persons(1, 300, 400, dx=random.uniform(-2, 2), dy=random.uniform(-2, 2))
    poses = make_fake_poses(1, 'standing', 'normal')
    rec.update(persons, poses, frame, 200)
    time.sleep(0.001)  # small delay for time progression
# Analyze
persons = make_fake_persons(1, 300, 400)
poses = make_fake_poses(1, 'standing', 'normal')
result = rec.analyze(persons, poses)
for tid, r in result.items():
    print(f"  track {tid}: score={r['threat_score']:.2f}, activities={r['activities']}")
    print(f"    speed={r['speed']:.1f} dwell={r['dwell_time']:.1f}s accel={r['acceleration']:.1f}")
    for sig, val in r['signals'].items():
        print(f"    signal {sig}: {val}")

print()
print("=" * 60)
print("TEST 2: SPRINTING (person moves fast)")
print("=" * 60)
# Person moves rapidly across the frame
rec2 = get_recognizer()
for frame in range(30):
    x = 100 + frame * 50  # move 50px per frame
    persons = make_fake_persons(1, x, 400)
    poses = make_fake_poses(1, 'standing', 'normal')
    rec2.update(persons, poses, frame, 100)
    time.sleep(0.02)  # 20ms = 50 FPS simulation, but x moves 50px per frame = 2500 px/sec
persons = make_fake_persons(1, 100 + 30*50, 400)
result = rec2.analyze(persons, poses)
for tid, r in result.items():
    print(f"  track {tid}: score={r['threat_score']:.2f}, activities={r['activities']}")
    print(f"    speed={r['speed']:.1f} dwell={r['dwell_time']:.1f}s")

print()
print("=" * 60)
print("TEST 3: FALL DETECTED (standing -> fallen transition)")
print("=" * 60)
rec3 = get_recognizer()
# Start standing, then fall
postures = ['standing'] * 10 + ['standing', 'standing', 'fallen', 'fallen']
for frame, posture in enumerate(postures):
    persons = make_fake_persons(1, 300, 400)
    poses = make_fake_poses(1, posture, 'normal')
    rec3.update(persons, poses, frame, 200)
persons = make_fake_persons(1, 300, 400)
result = rec3.analyze(persons, make_fake_poses(1, 'fallen', 'normal'))
for tid, r in result.items():
    print(f"  track {tid}: score={r['threat_score']:.2f}, activities={r['activities']}")
    for sig, val in r['signals'].items():
        print(f"    signal {sig}: {val}")

print()
print("=" * 60)
print("TEST 4: ZIGZAG (path curvature)")
print("=" * 60)
rec4 = get_recognizer()
# Move in a zigzag pattern
for frame in range(20):
    x = 100 + frame * 30
    y = 400 + (30 if frame % 2 == 0 else -30)
    persons = make_fake_persons(1, x, y)
    poses = make_fake_poses(1, 'standing', 'normal')
    rec4.update(persons, poses, frame, 200)
result = rec4.analyze(persons, poses)
for tid, r in result.items():
    print(f"  track {tid}: score={r['threat_score']:.2f}, activities={r['activities']}")
    print(f"    curvature={r['curvature']:.2f} (1.0=straight, >2.0=zigzag)")
