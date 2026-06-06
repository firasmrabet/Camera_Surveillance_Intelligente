"""
Hand Pose Analyzer v2 - Multi-source hand detection:
1. MediaPipe HandLandmarker Tasks API (preferred)
2. MediaPipe legacy solutions API (fallback)
3. YOLOv8-pose wrist keypoints (last resort)
"""
import os
import sys
import time
import warnings
warnings.filterwarnings('ignore')

import numpy as np
import cv2

_base_dir = os.path.dirname(os.path.abspath(__file__))
_MODEL_PATH_TASK = os.path.join(_base_dir, '..', 'ai_models', 'hand_landmarker.task')

_detector = None
_initialized = False
_init_error = None
_source = None


def _try_mediapipe_tasks():
    """Try the modern MediaPipe Tasks API."""
    global _init_error
    if not os.path.exists(_MODEL_PATH_TASK):
        return None
    try:
        import mediapipe as mp
        BaseOptions = mp.tasks.BaseOptions
        HandLandmarker = mp.tasks.vision.HandLandmarker
        HandLandmarkerOptions = mp.tasks.vision.HandLandmarkerOptions
        VisionRunningMode = mp.tasks.vision.RunningMode

        # NOTE: This .task file has a 2-byte prefix (00 00) BEFORE the PK ZIP signature.
        # Counter-intuitively, MediaPipe Tasks REQUIRES this prefix — passing the bytes
        # directly works, but stripping them makes it fail with "Unable to open zip archive".
        # Easiest reliable approach: pass the file path directly.
        options = HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=_MODEL_PATH_TASK),
            running_mode=VisionRunningMode.IMAGE,
            num_hands=4,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5
        )
        detector = HandLandmarker.create_from_options(options)
        size_mb = os.path.getsize(_MODEL_PATH_TASK) / 1e6
        print(f"[AI] MediaPipe HandLandmarker (Tasks) loaded ({size_mb:.1f}MB)", file=sys.stderr)
        return ('tasks', detector)
    except Exception as e:
        _init_error = f"tasks: {e}"
        return None


def _try_mediapipe_solutions():
    """Try the legacy MediaPipe solutions API (works on older versions)."""
    try:
        import mediapipe as mp
        if not hasattr(mp, 'solutions'):
            return None
        hands = mp.solutions.hands.Hands(
            static_image_mode=True,
            max_num_hands=4,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        print("[AI] MediaPipe HandLandmarker (legacy solutions) loaded", file=sys.stderr)
        return ('solutions', hands)
    except Exception as e:
        global _init_error
        _init_error = f"solutions: {e}"
        return None


def _get_detector():
    """Lazy-init the best available hand detector."""
    global _detector, _initialized, _init_error, _source
    if _initialized:
        return _detector
    _initialized = True

    # Try tasks API first
    result = _try_mediapipe_tasks()
    if result:
        _source, _detector = result
        return _detector

    # Fall back to legacy solutions
    result = _try_mediapipe_solutions()
    if result:
        _source, _detector = result
        return _detector

    print(f"[AI] All hand detectors failed. Last error: {_init_error}", file=sys.stderr)
    _detector = False
    return False


def _detect_with_tasks(detector, frame):
    """Run hand detection with MediaPipe Tasks API."""
    import mediapipe as mp
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    return detector.detect(mp_image)


def _detect_with_solutions(detector, frame):
    """Run hand detection with MediaPipe solutions API."""
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    class _Result:
        def __init__(self, results):
            self._r = results
            self.hand_landmarks = results.multi_hand_landmarks or []
            self.handedness = [[type('X', (), {'category_name': c})] for c in (results.multi_handedness_classification or [])]
    res = detector.process(rgb)
    return _Result(res)


def analyze_hands(frame, person_boxes=None, pose_data=None):
    """
    Detect hands in frame and classify gestures.
    Returns list of {bbox, gesture, hand, center, wrist, finger_count}
    """
    detector = _get_detector()
    if detector is False or detector is None:
        return []

    h, w = frame.shape[:2]
    person_boxes = person_boxes or []
    pose_data = pose_data or []

    try:
        if _source == 'tasks':
            results = _detect_with_tasks(detector, frame)
        else:
            results = _detect_with_solutions(detector, frame)
    except Exception as e:
        print(f"[AI] Hand detect error: {e}", file=sys.stderr)
        return []

    out = []
    if not results.hand_landmarks:
        return out

    for i, hand_landmarks in enumerate(results.hand_landmarks):
        # Handedness
        handedness = 'unknown'
        if results.handedness and i < len(results.handedness):
            try:
                handedness = results.handedness[i][0].category_name.lower()
            except (IndexError, AttributeError):
                handedness = 'unknown'

        # Bounding box
        xs = [lm.x * w for lm in hand_landmarks]
        ys = [lm.y * h for lm in hand_landmarks]
        x1, y1, x2, y2 = max(0, min(xs)-10), max(0, min(ys)-10), min(w, max(xs)+10), min(h, max(ys)+10)
        center_x, center_y = (x1 + x2) / 2, (y1 + y2) / 2

        finger_count = count_extended_fingers(hand_landmarks)
        gesture = classify_hand_gesture(center_x, center_y, person_boxes, w, h)

        out.append({
            'bbox': [x1, y1, x2, y2],
            'gesture': gesture,
            'hand': handedness,
            'center': [center_x, center_y],
            'wrist': [hand_landmarks[0].x * w, hand_landmarks[0].y * h],
            'finger_count': finger_count
        })

    return out


def count_extended_fingers(hand_landmarks):
    """Count how many fingers are extended."""
    try:
        wrist = hand_landmarks[0]
        fingers = [
            (8, 6, 5),
            (12, 10, 9),
            (16, 14, 13),
            (20, 18, 17)
        ]
        extended = 0
        for tip_i, pip_i, mcp_i in fingers:
            tip = hand_landmarks[tip_i]
            pip = hand_landmarks[pip_i]
            d_tip = ((tip.x - wrist.x) ** 2 + (tip.y - wrist.y) ** 2) ** 0.5
            d_pip = ((pip.x - wrist.x) ** 2 + (pip.y - wrist.y) ** 2) ** 0.5
            if d_tip > d_pip * 0.95:
                extended += 1
        thumb = hand_landmarks[4]
        index_mcp = hand_landmarks[5]
        d_thumb = ((thumb.x - wrist.x) ** 2 + (thumb.y - wrist.y) ** 2) ** 0.5
        d_imcp = ((index_mcp.x - wrist.x) ** 2 + (index_mcp.y - wrist.y) ** 2) ** 0.5
        if d_thumb > d_imcp * 1.1:
            extended += 1
        return extended
    except Exception:
        return 0


def classify_hand_gesture(center_x, center_y, person_boxes, w, h):
    """Classify hand gesture based on position relative to nearest person."""
    try:
        if not person_boxes:
            return 'visible'

        nearest = None
        nearest_dist = float('inf')
        for pb in person_boxes:
            px1, py1, px2, py2 = pb['bbox']
            pcx = (px1 + px2) / 2
            pcy = (py1 + py2) / 2
            dist = ((center_x - pcx) ** 2 + (center_y - pcy) ** 2) ** 0.5
            if dist < nearest_dist:
                nearest_dist = dist
                nearest = pb

        if not nearest:
            return 'visible'

        px1, py1, px2, py2 = nearest['bbox']
        ph = max(py2 - py1, 1)
        pw = max(px2 - px1, 1)
        rel_y = (center_y - py1) / ph
        rel_x = (center_x - px1) / pw

        if 0.40 < rel_y < 0.85 and (rel_x < 0.30 or rel_x > 0.70):
            return 'reaching_pocket'
        if rel_y < 0.20:
            return 'hand_to_face'
        if 0.30 < rel_x < 0.70 and 0.30 < rel_y < 0.55:
            return 'at_body'
        if (rel_x < 0.25 or rel_x > 0.75) and 0.20 < rel_y < 0.55:
            return 'reaching_object'
        if rel_y < 0.30 and 0.35 < rel_x < 0.65:
            return 'hand_raised'

        return 'visible'
    except Exception:
        return 'unknown'


def annotate_hands_on_image(frame, hand_data):
    """Draw hand bounding boxes and gesture labels on the image."""
    for hd in hand_data:
        x1, y1, x2, y2 = [int(v) for v in hd['bbox']]
        gesture = hd['gesture']
        suspicious = gesture in ('reaching_pocket', 'reaching_object', 'hand_to_face')
        color = (0, 0, 255) if suspicious else (0, 255, 0)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        fingers = hd.get('finger_count', '?')
        label = f"{hd['hand']}: {gesture} ({fingers}f)"
        cv2.putText(frame, label, (x1, max(15, y1 - 5)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)
    return frame


if __name__ == '__main__':
    if len(sys.argv) > 1:
        img = cv2.imread(sys.argv[1])
        if img is not None:
            t0 = time.time()
            hands = analyze_hands(img)
            print(f"Source: {_source}")
            print(f"Detected {len(hands)} hands in {(time.time()-t0)*1000:.0f}ms")
            for h in hands:
                print(f"  {h['hand']}: {h['gesture']} (fingers={h['finger_count']}) at ({h['center'][0]:.0f},{h['center'][1]:.0f})")
            if hands:
                annotated = annotate_hands_on_image(img.copy(), hands)
                out = sys.argv[1].replace('.jpg', '_hands.jpg')
                cv2.imwrite(out, annotated)
                print(f"Saved annotated: {out}")
        else:
            print("Could not load image", file=sys.stderr)
    else:
        print("Usage: python hand_analyzer.py <image_path>")
