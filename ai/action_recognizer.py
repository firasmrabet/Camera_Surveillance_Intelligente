"""
Temporal Action Analyzer - Detects suspicious activities across frames
without needing a video dataset. Uses:
- Motion vectors (frame differencing) to detect:
  - Loitering (low motion over time)
  - Sudden running (high acceleration)
  - Falling (sudden vertical motion)
  - Abnormal trajectories (zigzag)
- Track-based behavior (DeepSort output):
  - Dwell time in zones
  - Speed changes
  - Pose transitions

This is fully rule-based, no model training needed.
"""
import time
import math
import numpy as np
from collections import defaultdict, deque


class TemporalTracker:
    """Tracks activity per person across frames."""

    def __init__(self, history_size=30):
        self.history = defaultdict(lambda: deque(maxlen=history_size))
        self.first_seen = {}
        self.last_seen = {}
        self.fps_estimate = 5  # default, will be updated

    def update_fps(self, processing_time_ms):
        if processing_time_ms > 0:
            self.fps_estimate = max(1, min(30, 1000 / processing_time_ms))

    def update(self, tracked_persons, pose_by_track, frame_idx):
        """Update history with current frame detections."""
        now = time.time()
        current_ids = set()

        # Build a map of track_id -> pose info
        pose_map = {p['track_id']: p for p in pose_by_track}

        for person in tracked_persons:
            tid = person['track_id']
            current_ids.add(tid)
            bbox = person['bbox']
            cx = (bbox[0] + bbox[2]) / 2
            cy = (bbox[1] + bbox[3]) / 2

            pose = pose_map.get(tid, {})
            posture = pose.get('posture', 'unknown')
            gesture = pose.get('gesture', 'unknown')

            entry = {
                't': now,
                'frame': frame_idx,
                'cx': cx,
                'cy': cy,
                'bbox': bbox,
                'posture': posture,
                'gesture': gesture
            }
            self.history[tid].append(entry)

            if tid not in self.first_seen:
                self.first_seen[tid] = now
            self.last_seen[tid] = now

        # Cleanup tracks that have disappeared
        for tid in list(self.history.keys()):
            if tid not in current_ids:
                if now - self.last_seen.get(tid, now) > 5:  # 5s grace
                    pass  # keep history for a bit for late analysis

    def get_track_speed(self, tid, window=5):
        """Return average speed (px/sec) of a track over last `window` frames."""
        hist = list(self.history.get(tid, []))
        if len(hist) < 2:
            return 0
        window = min(window, len(hist))
        recent = hist[-window:]
        if len(recent) < 2:
            return 0
        dt = recent[-1]['t'] - recent[0]['t']
        if dt <= 0:
            return 0
        total_dist = 0
        for i in range(1, len(recent)):
            dx = recent[i]['cx'] - recent[i-1]['cx']
            dy = recent[i]['cy'] - recent[i-1]['cy']
            total_dist += math.sqrt(dx*dx + dy*dy)
        return total_dist / dt

    def get_dwell_time(self, tid):
        """Return how long (seconds) a track has been visible."""
        if tid not in self.first_seen:
            return 0
        return time.time() - self.first_seen[tid]

    def get_acceleration(self, tid, window=5):
        """Return acceleration magnitude (px/sec^2)."""
        hist = list(self.history.get(tid, []))
        if len(hist) < 3:
            return 0
        window = min(window, len(hist))
        recent = hist[-window:]
        speeds = []
        for i in range(1, len(recent)):
            dt = recent[i]['t'] - recent[i-1]['t']
            if dt <= 0:
                continue
            dx = recent[i]['cx'] - recent[i-1]['cx']
            dy = recent[i]['cy'] - recent[i-1]['cy']
            speeds.append(math.sqrt(dx*dx + dy*dy) / dt)
        if len(speeds) < 2:
            return 0
        # acceleration = difference in speeds / time
        total_dt = recent[-1]['t'] - recent[0]['t']
        if total_dt <= 0:
            return 0
        return abs(speeds[-1] - speeds[0]) / total_dt

    def get_trajectory_curvature(self, tid, window=10):
        """Estimate path curvature (higher = more zigzag)."""
        hist = list(self.history.get(tid, []))
        if len(hist) < 4:
            return 0
        window = min(window, len(hist))
        recent = hist[-window:]
        # Total path length
        path_len = 0
        for i in range(1, len(recent)):
            dx = recent[i]['cx'] - recent[i-1]['cx']
            dy = recent[i]['cy'] - recent[i-1]['cy']
            path_len += math.sqrt(dx*dx + dy*dy)
        # Direct distance
        dx = recent[-1]['cx'] - recent[0]['cx']
        dy = recent[-1]['cy'] - recent[0]['cy']
        direct_dist = math.sqrt(dx*dx + dy*dy)
        if direct_dist < 5:
            return 0
        # Curvature ratio: path_len / direct_dist
        # = 1 for straight line, higher for zigzag
        return path_len / direct_dist

    def get_posture_history(self, tid, window=10):
        """Get list of recent postures for a track."""
        hist = list(self.history.get(tid, []))
        window = min(window, len(hist))
        return [h['posture'] for h in hist[-window:]]


class ActionRecognizer:
    """Combines motion analysis to recognize suspicious activities."""

    def __init__(self):
        self.tracker = TemporalTracker()

        # Tunable thresholds (calibrated for ~5-15 FPS processing)
        self.SPEED_RUNNING = 200  # px/sec
        self.SPEED_SPRINT = 400
        self.LOITER_DWELL_SEC = 60
        self.LOITER_DWELL_SUSPICIOUS = 180
        self.LOITER_DWELL_CRITICAL = 300
        self.ACCELERATION_SUDDEN = 300  # px/sec^2
        self.CURVATURE_ZIGZAG = 2.0

    def update(self, tracked_persons, pose_by_track, frame_idx, processing_ms=200):
        """Update internal state. Call this every frame."""
        self.tracker.update_fps(processing_ms)
        self.tracker.update(tracked_persons, pose_by_track, frame_idx)

    def analyze(self, tracked_persons, pose_by_track):
        """
        For each tracked person, compute activity signals and overall threat score.
        Returns dict: {track_id: {signals: [...], threat_score: 0..1, activities: [...]}}
        """
        results = {}
        for p in tracked_persons:
            tid = p['track_id']
            speed = self.tracker.get_track_speed(tid)
            dwell = self.tracker.get_dwell_time(tid)
            accel = self.tracker.get_acceleration(tid)
            curvature = self.tracker.get_trajectory_curvature(tid)
            posture_hist = self.tracker.get_posture_history(tid)

            signals = {}
            activities = []

            # 1) Loitering detection
            if dwell > self.LOITER_DWELL_CRITICAL and speed < 30:
                signals['loitering_critical'] = 0.85
                activities.append('loitering_critical')
            elif dwell > self.LOITER_DWELL_SUSPICIOUS and speed < 50:
                signals['loitering_suspicious'] = 0.55
                activities.append('loitering_suspicious')
            elif dwell > self.LOITER_DWELL_SEC and speed < 30:
                signals['loitering'] = 0.30
                activities.append('loitering')

            # 2) Running/sprinting
            if speed > self.SPEED_SPRINT:
                signals['sprinting'] = 0.40
                activities.append('sprinting')
            elif speed > self.SPEED_RUNNING:
                signals['running'] = 0.20
                activities.append('running')

            # 3) Sudden acceleration (startling)
            if accel > self.ACCELERATION_SUDDEN:
                signals['sudden_movement'] = 0.30
                activities.append('sudden_movement')

            # 4) Zigzag trajectory
            if curvature > self.CURVATURE_ZIGZAG:
                signals['zigzag'] = 0.25
                activities.append('zigzag')

            # 5) Pose transition: standing -> fallen (medical emergency, fight)
            if len(posture_hist) >= 4:
                if 'standing' in posture_hist[:-2] and posture_hist[-1] == 'fallen':
                    signals['fall_detected'] = 0.75
                    activities.append('fall_detected')
                if 'standing' in posture_hist[:-2] and posture_hist[-1] == 'crouching':
                    signals['crouching_after_standing'] = 0.20
                    activities.append('crouching')

            # 6) Persistent crouching (suspicious)
            if len(posture_hist) >= 5:
                crouch_count = sum(1 for p in posture_hist[-5:] if p == 'crouching')
                if crouch_count >= 4:
                    signals['persistent_crouching'] = 0.30
                    activities.append('persistent_crouching')

            # Aggregate score (sum of signals, capped at 1)
            threat_score = min(1.0, sum(signals.values()))

            results[tid] = {
                'signals': signals,
                'activities': activities,
                'threat_score': threat_score,
                'speed': speed,
                'dwell_time': dwell,
                'acceleration': accel,
                'curvature': curvature
            }

        return results


# Singleton instance
_recognizer = None


def get_recognizer():
    global _recognizer
    if _recognizer is None:
        _recognizer = ActionRecognizer()
    return _recognizer


if __name__ == '__main__':
    import random
    rec = get_recognizer()

    # Simulate a person loitering at low speed for 90 seconds
    base_x, base_y = 100, 100
    for frame in range(50):
        # Small jittery motion
        x = base_x + random.uniform(-3, 3)
        y = base_y + random.uniform(-3, 3)
        fake_person = {'track_id': 1, 'bbox': [x-20, y-40, x+20, y+40]}
        fake_pose = [{'track_id': 1, 'posture': 'standing', 'gesture': 'normal'}]
        rec.update([fake_person], fake_pose, frame, 200)
        time.sleep(0.001)  # small delay for time progression

    # Now make them run
    for frame in range(50, 60):
        x = base_x + (frame - 50) * 20
        fake_person = {'track_id': 1, 'bbox': [x-20, y-40, x+20, y+40]}
        rec.update([fake_person], fake_pose, frame, 200)
        time.sleep(0.01)

    # Analyze
    fake_persons = [{'track_id': 1, 'bbox': [500, 100, 540, 180]}]
    result = rec.analyze(fake_persons, fake_pose)
    print("Loitering test:")
    for tid, r in result.items():
        print(f"  track {tid}: score={r['threat_score']:.2f} activities={r['activities']}")
        print(f"    speed={r['speed']:.1f} dwell={r['dwell_time']:.1f}s accel={r['acceleration']:.1f}")
