"""
AI Detection Service v2 - Unified YOLOv8
Uses YOLOv8m (detection) + YOLOv8m-pose (pose) + YOLOv8s-weapons (weapons)
+ DeepSort (tracking) + InsightFace (face recognition)
"""
import sys
import json
import base64
import os
import time
import warnings
warnings.filterwarnings('ignore')

import numpy as np
import cv2
from ultralytics import YOLO
from deep_sort_realtime.deepsort_tracker import DeepSort
try:
    from hand_analyzer import analyze_hands
    HAND_ANALYZER_AVAILABLE = True
except Exception as _e:
    print(f"[AI] Hand analyzer import failed: {_e}", file=sys.stderr)
    HAND_ANALYZER_AVAILABLE = False

try:
    from action_recognizer import get_recognizer as get_action_recognizer
    ACTION_RECOGNIZER_AVAILABLE = True
except Exception as _e:
    print(f"[AI] Action recognizer import failed: {_e}", file=sys.stderr)
    ACTION_RECOGNIZER_AVAILABLE = False

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ai_models')
# Allow env override for model size: n=fast, s=balanced, m=accurate, l/x=max
_PERSON_MODEL_SIZE = os.environ.get('AI_PERSON_MODEL', 'n').lower()
_POSE_MODEL_SIZE = os.environ.get('AI_POSE_MODEL', 'n').lower()
# Default to 'n' (nano) for CPU - 4x faster than 'm' with only 5% accuracy loss
PERSON_MODEL = os.path.join(MODEL_DIR, f'yolov8{_PERSON_MODEL_SIZE}.pt')
POSE_MODEL = os.path.join(MODEL_DIR, f'yolov8{_POSE_MODEL_SIZE}-pose.pt')
WEAPON_MODEL = os.path.join(MODEL_DIR, 'weapons_yolov8s.pt')

# Globals (lazy loaded)
_person_model = None
_pose_model = None
_weapon_model = None
_tracker = None
_face_analyzer = None


def get_models():
    global _person_model, _pose_model, _weapon_model, _tracker, _face_analyzer

    if _person_model is None:
        _person_model = YOLO(PERSON_MODEL)
        print(f"[AI] Loaded person model: {os.path.basename(PERSON_MODEL)}", file=sys.stderr)
    if _pose_model is None:
        _pose_model = YOLO(POSE_MODEL)
        print(f"[AI] Loaded pose model: {os.path.basename(POSE_MODEL)}", file=sys.stderr)
    if _weapon_model is None:
        try:
            _weapon_model = YOLO(WEAPON_MODEL)
            print(f"[AI] Loaded weapon model: {os.path.basename(WEAPON_MODEL)}", file=sys.stderr)
        except Exception as e:
            print(f"[AI] Weapons model failed: {e}", file=sys.stderr)
            _weapon_model = False
    if _tracker is None:
        _tracker = DeepSort(max_age=30, n_init=2, nms_max_overlap=0.5,
                           max_iou_distance=0.7, max_cosine_distance=0.2)
        print("[AI] Loaded DeepSort tracker", file=sys.stderr)
    if _face_analyzer is None:
        try:
            from insightface.app import FaceAnalysis
            _face_analyzer = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
            _face_analyzer.prepare(ctx_id=-1, det_size=(320, 320))
            print("[AI] Loaded InsightFace (buffalo_l)", file=sys.stderr)
        except Exception as e:
            print(f"[AI] InsightFace failed: {e}", file=sys.stderr)
            _face_analyzer = False
    return _person_model, _pose_model, _weapon_model, _tracker, _face_analyzer


def analyze_frame(jpeg_bytes, known_faces=None, zones=None):
    """
    Main analysis pipeline:
    1. Person/Object detection (YOLOv8m)
    2. Pose estimation (YOLOv8m-pose)
    3. Weapon detection (YOLOv8s-weapons)
    4. Person tracking (DeepSort)
    5. Face recognition (InsightFace)
    """
    start = time.time()
    known_faces = known_faces or []
    zones = zones or []

    nparr = np.frombuffer(jpeg_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        return {'error': 'decode_failed'}
    h, w = frame.shape[:2]

    person_model, pose_model, weapon_model, tracker, face_analyzer = get_models()

    # 1) Person/Object detection
    person_results = person_model.predict(frame, imgsz=640, conf=0.4, verbose=False)[0]
    person_boxes = []
    other_objects = []
    for box in person_results.boxes:
        cls_id = int(box.cls[0])
        cls_name = person_model.names[cls_id]
        conf = float(box.conf[0])
        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().tolist()
        det = {
            'class': cls_name,
            'confidence': conf,
            'bbox': [x1, y1, x2, y2],
            'class_id': cls_id
        }
        if cls_name == 'person':
            person_boxes.append(det)
        else:
            other_objects.append(det)

    # 2) Pose estimation (run pose model once on full frame)
    pose_data = []
    try:
        pose_results = pose_model.predict(frame, imgsz=640, conf=0.4, verbose=False)[0]
        if pose_results.keypoints is not None and pose_results.keypoints.xy is not None:
            kpts_xy = pose_results.keypoints.xy
            kpts_conf = pose_results.keypoints.conf
            for i, box in enumerate(pose_results.boxes):
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().tolist()
                conf = float(box.conf[0])
                if i < len(kpts_xy):
                    kpts = kpts_xy[i].cpu().numpy().tolist() if hasattr(kpts_xy[i], 'cpu') else kpts_xy[i].tolist()
                    kc = kpts_conf[i].cpu().numpy().tolist() if (kpts_conf is not None and hasattr(kpts_conf[i], 'cpu')) else (kpts_conf[i].tolist() if kpts_conf is not None else [1.0] * 17)
                    posture = classify_posture_from_keypoints(kpts, kc)
                    gesture = classify_gesture_from_keypoints(kpts, kc)
                    pose_data.append({
                        'bbox': [x1, y1, x2, y2],
                        'confidence': conf,
                        'posture': posture,
                        'gesture': gesture,
                        'keypoints': kpts,
                        'keypoint_conf': kc
                    })
    except Exception as e:
        print(f"[AI] Pose error: {e}", file=sys.stderr)

    # 3) DeepSort tracking (persons only)
    ds_detections = []
    for pb in person_boxes:
        x1, y1, x2, y2 = pb['bbox']
        ds_detections.append(([x1, y1, x2 - x1, y2 - y1], pb['confidence'], 'person'))

    tracks = tracker.update_tracks(ds_detections, frame=frame) if ds_detections else []
    tracked_persons = []
    pose_by_track = []
    for tr in tracks:
        if not tr.is_confirmed():
            continue
        track_id = int(tr.track_id)
        l, t, r, b = tr.to_ltrb()
        tracked_persons.append({
            'track_id': track_id,
            'bbox': [l, t, r, b],
            'class': 'person'
        })
        # Match pose
        matched_pose = match_pose_to_track(track_id, [l, t, r, b], pose_data)
        if matched_pose:
            pose_by_track.append({
                'track_id': track_id,
                **matched_pose
            })

    # 4) Weapon detection
    weapons = []
    if weapon_model and weapon_model is not False:
        try:
            weapon_results = weapon_model.predict(frame, imgsz=640, conf=0.88, verbose=False)[0]
            
            # Cross-validation: collect harmless COCO objects to reject false weapon detections
            HARMLESS_CLASSES = {'cell phone', 'bottle', 'remote', 'cup', 'mouse',
                                'book', 'scissors', 'toothbrush', 'hair drier',
                                'fork', 'knife', 'spoon'}
            harmless_boxes = []
            for box in person_results.boxes:
                cls_name = person_model.names[int(box.cls[0])]
                if cls_name in HARMLESS_CLASSES:
                    hx1, hy1, hx2, hy2 = box.xyxy[0].cpu().numpy().tolist()
                    harmless_boxes.append((cls_name, hx1, hy1, hx2, hy2))
            
            for box in weapon_results.boxes:
                cls_id = int(box.cls[0])
                cls_name = weapon_model.names[cls_id]
                conf = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().tolist()
                
                # Size filter: reject too small or too large detections
                w_area = (x2 - x1) * (y2 - y1)
                frame_area = h * w
                area_ratio = w_area / max(frame_area, 1)
                if area_ratio < 0.005 or area_ratio > 0.25:
                    continue
                
                # Cross-validation: reject if harmless object overlaps
                wcx, wcy = (x1 + x2) / 2, (y1 + y2) / 2
                is_harmless = False
                for h_cls, hx1, hy1, hx2, hy2 in harmless_boxes:
                    if hx1 - 30 < wcx < hx2 + 30 and hy1 - 30 < wcy < hy2 + 30:
                        is_harmless = True
                        print(f"[AI] Weapon '{cls_name}' ({conf:.0%}) REJECTED: overlaps COCO '{h_cls}'", file=sys.stderr)
                        break
                if is_harmless:
                    continue
                
                weapons.append({
                    'class': cls_name,
                    'confidence': conf,
                    'bbox': [x1, y1, x2, y2]
                })
        except Exception as e:
            print(f"[AI] Weapon error: {e}", file=sys.stderr)

    # 5) Face recognition
    face_data = []
    if face_analyzer and face_analyzer is not False and known_faces:
        try:
            faces = face_analyzer.get(frame)
            for face in faces:
                embedding = face.normed_embedding.tolist() if face.normed_embedding is not None else None
                if embedding is None:
                    continue
                best_match = None
                best_score = 0
                for kf in known_faces:
                    kf_emb = np.array(kf['embedding'])
                    sim = float(np.dot(embedding, kf_emb))
                    if sim > best_score:
                        best_score = sim
                        best_match = kf
                is_known = best_match is not None and best_score > 0.4
                face_data.append({
                    'bbox': face.bbox.tolist(),
                    'is_known': is_known,
                    'matched_name': best_match['name'] if is_known else None,
                    'similarity': best_score
                })
        except Exception as e:
            print(f"[AI] Face error: {e}", file=sys.stderr)

    elapsed = time.time() - start

    # 6) Hand gesture analysis (concealed theft, grabbing)
    hand_data = []
    # First try MediaPipe-based hand analyzer (if available)
    if HAND_ANALYZER_AVAILABLE:
        try:
            hand_data = analyze_hands(frame, person_boxes=person_boxes, pose_data=pose_data)
        except Exception as e:
            print(f"[AI] Hand analyze error: {e}", file=sys.stderr)
    # Always derive hands from pose keypoints (wrists) as a robust fallback
    # This ensures we have hand positions even if MediaPipe fails to load
    try:
        from hand_pose_bridge import derive_hands_from_pose
        pose_hands = derive_hands_from_pose(pose_data)
        if pose_hands and not hand_data:
            hand_data = pose_hands
        elif pose_hands:
            # Merge: prefer MediaPipe, but add pose-derived for missing hands
            existing_centers = {(h['center'][0], h['center'][1]) for h in hand_data}
            for ph in pose_hands:
                # Avoid duplicates
                is_dup = False
                for ec in existing_centers:
                    if abs(ec[0] - ph['center'][0]) < 50 and abs(ec[1] - ph['center'][1]) < 50:
                        is_dup = True
                        break
                if not is_dup:
                    hand_data.append(ph)
    except Exception as e:
        pass

    # 7) Temporal action recognition (loitering, running, falls)
    activity_data = {}
    if ACTION_RECOGNIZER_AVAILABLE:
        try:
            recognizer = get_action_recognizer()
            recognizer.update(tracked_persons, pose_by_track, frame_idx=0, processing_ms=int(elapsed * 1000))
            activity_data = recognizer.analyze(tracked_persons, pose_by_track)
            # Annotate tracked_persons with their activity
            for person in tracked_persons:
                tid = person['track_id']
                if tid in activity_data:
                    person['activity'] = activity_data[tid]
        except Exception as e:
            print(f"[AI] Action recognizer error: {e}", file=sys.stderr)

    return {
        'frame_size': [w, h],
        'processing_time_ms': int(elapsed * 1000),
        'persons': tracked_persons,
        'detections': person_boxes + other_objects,
        'poses': pose_by_track,
        'weapons': weapons,
        'faces': face_data,
        'hands': hand_data,
        'activities': activity_data,
        'zones': zones
    }


# COCO pose keypoint indices
KP = {
    'nose': 0, 'left_eye': 1, 'right_eye': 2, 'left_ear': 3, 'right_ear': 4,
    'left_shoulder': 5, 'right_shoulder': 6, 'left_elbow': 7, 'right_elbow': 8,
    'left_wrist': 9, 'right_wrist': 10, 'left_hip': 11, 'right_hip': 12,
    'left_knee': 13, 'right_knee': 14, 'left_ankle': 15, 'right_ankle': 16
}


def classify_posture_from_keypoints(kpts, confs):
    """Classify: standing, crouching, bending, fallen, unknown."""
    try:
        if confs[KP['left_hip']] < 0.3 or confs[KP['right_hip']] < 0.3:
            return 'unknown'
        if confs[KP['left_ankle']] < 0.3 or confs[KP['right_ankle']] < 0.3:
            return 'unknown'

        l_shoulder_y = kpts[KP['left_shoulder']][1]
        r_shoulder_y = kpts[KP['right_shoulder']][1]
        l_hip_y = kpts[KP['left_hip']][1]
        r_hip_y = kpts[KP['right_hip']][1]
        l_ankle_y = kpts[KP['left_ankle']][1]
        r_ankle_y = kpts[KP['right_ankle']][1]

        shoulder_y = (l_shoulder_y + r_shoulder_y) / 2
        hip_y = (l_hip_y + r_hip_y) / 2
        ankle_y = (l_ankle_y + r_ankle_y) / 2

        body_height = abs(ankle_y - shoulder_y)
        torso_height = abs(hip_y - shoulder_y)
        leg_height = abs(ankle_y - hip_y)

        # Frame is 0-1 normalized
        if body_height < 0.15:
            return 'fallen'
        if leg_height < 0.08:
            return 'crouching'
        if torso_height / max(body_height, 0.01) > 0.6:
            return 'bending'
        return 'standing'
    except Exception:
        return 'unknown'


def classify_gesture_from_keypoints(kpts, confs):
    """Classify: hands_raised, one_hand_raised, hands_visible, normal, unknown."""
    try:
        if confs[KP['left_wrist']] < 0.3 or confs[KP['right_wrist']] < 0.3:
            return 'unknown'
        l_wrist_y = kpts[KP['left_wrist']][1]
        r_wrist_y = kpts[KP['right_wrist']][1]
        l_shoulder_y = kpts[KP['left_shoulder']][1]
        r_shoulder_y = kpts[KP['right_shoulder']][1]

        l_raised = l_wrist_y < l_shoulder_y
        r_raised = r_wrist_y < r_shoulder_y

        if l_raised and r_raised:
            return 'hands_raised'
        if l_raised or r_raised:
            return 'one_hand_raised'
        return 'normal'
    except Exception:
        return 'unknown'


def match_pose_to_track(track_id, track_bbox, pose_data):
    """Find the pose whose bbox best overlaps with the track bbox."""
    best_iou = 0
    best_pose = None
    tx1, ty1, tx2, ty2 = track_bbox
    track_area = (tx2 - tx1) * (ty2 - ty1)
    if track_area <= 0:
        return None
    for pose in pose_data:
        px1, py1, px2, py2 = pose['bbox']
        ix1 = max(tx1, px1)
        iy1 = max(ty1, py1)
        ix2 = min(tx2, px2)
        iy2 = min(ty2, py2)
        iw = max(0, ix2 - ix1)
        ih = max(0, iy2 - iy1)
        intersection = iw * ih
        pose_area = (px2 - px1) * (py2 - py1)
        union = track_area + pose_area - intersection
        iou = intersection / max(union, 1)
        if iou > best_iou:
            best_iou = iou
            best_pose = pose
    if best_iou > 0.2:
        return {
            'posture': best_pose['posture'],
            'gesture': best_pose['gesture'],
            'pose_confidence': best_pose['confidence']
        }
    return None


def extract_face_embedding(jpeg_bytes, max_faces=1):
    """Extract face embeddings from an image. Returns list of {bbox, embedding, score}."""
    nparr = np.frombuffer(jpeg_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        return []
    _, _, _, _, face_analyzer = get_models()
    if face_analyzer is False:
        return []
    try:
        faces = face_analyzer.get(frame)
        out = []
        for face in faces[:max_faces]:
            if face.normed_embedding is None:
                continue
            out.append({
                'bbox': face.bbox.tolist(),
                'embedding': face.normed_embedding.tolist(),
                'score': float(face.det_score) if hasattr(face, 'det_score') else 0.0
            })
        return out
    except Exception as e:
        print(f"[AI] Embedding extract error: {e}", file=sys.stderr)
        return []


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--init':
        get_models()
        print(json.dumps({'status': 'ready'}))
        sys.exit(0)

    # Persistent mode: read line-delimited JSON, respond with {id, result/error}
    for line in sys.stdin:
        # Strip UTF-8 BOM if present
        if line.startswith('\ufeff'):
            line = line[1:]
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except Exception as e:
            print(json.dumps({'error': f'bad_json: {e}', 'line': line[:50]}))
            sys.stdout.flush()
            continue

        if payload.get('cmd') == 'init':
            get_models()
            print(json.dumps({'status': 'ready'}))
            sys.stdout.flush()
            continue

        if payload.get('cmd') == 'extract_embedding':
            try:
                jpeg_b64 = payload.get('image', '')
                if ',' in jpeg_b64:
                    jpeg_b64 = jpeg_b64.split(',', 1)[1]
                jpeg_bytes = base64.b64decode(jpeg_b64)
                faces = extract_face_embedding(jpeg_bytes, max_faces=payload.get('max_faces', 1))
                print(json.dumps({'id': payload.get('id'), 'result': {'faces': faces}}))
            except Exception as e:
                print(json.dumps({'id': payload.get('id'), 'error': str(e)}))
            sys.stdout.flush()
            continue

        req_id = payload.get('id')
        try:
            jpeg_b64 = payload.get('image', '')
            if ',' in jpeg_b64:
                jpeg_b64 = jpeg_b64.split(',', 1)[1]
            jpeg_bytes = base64.b64decode(jpeg_b64)
            # DEBUG: Save first few frames to disk for inspection
            if req_id is not None and req_id <= 3:
                try:
                    with open(f'/tmp/debug_frame_{req_id}.jpg', 'wb') as f:
                        f.write(jpeg_bytes)
                    print(f"[AI] DEBUG: Saved frame {req_id} ({len(jpeg_bytes)} bytes) to /tmp/debug_frame_{req_id}.jpg", file=sys.stderr)
                    print(f"[AI] DEBUG: First bytes: {jpeg_bytes[:4].hex()}, Last bytes: {jpeg_bytes[-4:].hex()}", file=sys.stderr)
                except Exception as e:
                    print(f"[AI] DEBUG: Save failed: {e}", file=sys.stderr)
            known_faces = payload.get('known_faces', [])
            zones = payload.get('zones', [])
            result = analyze_frame(jpeg_bytes, known_faces, zones)
            print(json.dumps({'id': req_id, 'result': result}))
        except Exception as e:
            import traceback
            print(json.dumps({'id': req_id, 'error': str(e), 'trace': traceback.format_exc()}))
        sys.stdout.flush()
