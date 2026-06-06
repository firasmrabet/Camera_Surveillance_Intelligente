"""
Sentinel AI Security — Moteur Production
Architecture : Détection → Buffer clip → Alerte opérateur → Confirmation → Police
"""

import sys
import json
import base64
import os
import time
import cv2
import numpy as np
from collections import deque
from datetime import datetime
from ultralytics import YOLO

# ═══════════════════════════════════════════════════════════
# CONFIG CRITIQUE — Seuils élevés pour minimiser faux positifs
# ═══════════════════════════════════════════════════════════
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ai_models')
CLIPS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server', 'clips')

CONFIG = {
    # Modèles (utilise LARGE par defaut, ou fall back)
    "model_person":    os.path.join(MODEL_DIR, "yolov8l.pt"),
    "model_pose":      os.path.join(MODEL_DIR, "yolov8l-pose.pt"),
    "model_weapon":    os.path.join(MODEL_DIR, "weapons_yolov8s.pt"), # Fallback to small if we don't have large weapon

    # Seuils de confiance très stricts
    "conf_person":     0.72,
    "conf_weapon":     0.70, # lowered slightly for custom model
    "conf_violence":   0.78,

    # Filtre temporel : frames consécutives requises
    "frames_weapon":   2,     # ~0.25s at 8fps (fast trigger for critical threats)
    "frames_violence": 8,     # ~1s at 8fps
    "frames_intrusion": 4,

    # Clip sauvegardé avant/après l'événement
    "clip_buffer_sec": 10,
    "clip_after_sec":  5,

    # Cooldown entre alertes (évite le spam)
    "cooldown_weapon":    30,
    "cooldown_violence":  20,
    "cooldown_intrusion": 15,

    "clips_dir": CLIPS_DIR,
}

os.makedirs(CONFIG["clips_dir"], exist_ok=True)

# ═══════════════════════════════════════════════════════════
# BUFFER VIDÉO
# ═══════════════════════════════════════════════════════════
class VideoBuffer:
    def __init__(self, fps=8, seconds=10):
        self.buffer = deque(maxlen=int(fps * seconds))
        self.fps = fps

    def add(self, frame: np.ndarray):
        self.buffer.append(frame.copy())

    def save_clip(self, alert_type: str, after_frames: list = None) -> str:
        """Sauvegarde clip avant + après l'événement."""
        if after_frames is None:
            after_frames = []
            
        # Créer le sous-dossier selon le type d'alerte
        subfolder = os.path.join(CONFIG['clips_dir'], alert_type.upper())
        os.makedirs(subfolder, exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{alert_type.upper()}_{timestamp}.mp4"
        filepath = os.path.join(subfolder, filename)
        
        frames = list(self.buffer) + after_frames
        if not frames:
            return ""
            
        h, w = frames[0].shape[:2]
        writer = cv2.VideoWriter(
            filepath,
            cv2.VideoWriter_fourcc(*"avc1"), # better browser compatibility than mp4v
            self.fps, (w, h)
        )
        for f in frames:
            writer.write(f)
        writer.release()
        
        print(f"[CLIP] Sauvegardé : {filepath}", file=sys.stderr)
        return f"/clips/{alert_type.upper()}/{filename}"

# ═══════════════════════════════════════════════════════════
# FILTRE TEMPOREL STRICT
# ═══════════════════════════════════════════════════════════
class StrictTemporalFilter:
    def __init__(self):
        self.counters = {}
        self.last_seen = {}
        self.last_alert = {}

    def update(self, event: str, detected: bool, threshold: int, cooldown: int) -> bool:
        now = time.time()
        if not detected:
            self.counters[event] = 0
            return False

        if now - self.last_seen.get(event, 0) > 2.0:
            self.counters[event] = 0

        self.counters[event] = self.counters.get(event, 0) + 1
        self.last_seen[event] = now

        if now - self.last_alert.get(event, 0) < cooldown:
            return False

        if self.counters[event] >= threshold:
            self.last_alert[event] = now
            self.counters[event] = 0
            return True
        return False

# ═══════════════════════════════════════════════════════════
# ANALYSEUR DE VIOLENCE
# ═══════════════════════════════════════════════════════════
class ViolenceAnalyzer:
    def __init__(self):
        self.histories = {}

    def update(self, track_id: int, kps: np.ndarray) -> dict:
        if track_id not in self.histories:
            self.histories[track_id] = deque(maxlen=25)
        self.histories[track_id].append(kps)
        hist = self.histories[track_id]
        return {
            "fighting":  self._is_fighting(hist),
            "falling":   self._is_falling(hist),
            "running":   self._is_running(hist),
            "loitering": self._is_loitering(hist),
        }

    def _kp(self, kps, idx):
        if idx >= len(kps): return None
        k = kps[idx]
        if float(k[2]) < 0.45: return None
        return float(k[0]), float(k[1])

    def _speed(self, hist, kp_idx, n=5):
        speeds = []
        for i in range(1, min(n, len(hist))):
            p1 = self._kp(hist[-i-1], kp_idx)
            p2 = self._kp(hist[-i],   kp_idx)
            if p1 and p2:
                speeds.append(((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2) ** 0.5)
        return np.mean(speeds) if speeds else 0

    def _is_fighting(self, hist) -> bool:
        if len(hist) < 6: return False
        wrist_speed  = max(self._speed(hist, 9), self._speed(hist, 10))
        elbow_speed  = max(self._speed(hist, 7), self._speed(hist, 8))
        return wrist_speed > 40 and elbow_speed > 25

    def _is_falling(self, hist) -> bool:
        if len(hist) < 10: return False
        def body_ratio(kps):
            pts = [(float(k[0]), float(k[1])) for k in kps if float(k[2]) > 0.4]
            if len(pts) < 5: return None
            ys = [p[1] for p in pts]; xs = [p[0] for p in pts]
            h = max(ys) - min(ys); w = max(xs) - min(xs)
            return h / (w + 1e-5)
        r_old = body_ratio(hist[-10])
        r_new = body_ratio(hist[-1])
        if r_old and r_new:
            return r_new < r_old * 0.50
        return False

    def _is_running(self, hist) -> bool:
        if len(hist) < 5: return False
        hip_speed = max(self._speed(hist, 11), self._speed(hist, 12))
        return hip_speed > 22

    def _is_loitering(self, hist) -> bool:
        if len(hist) < 20: return False
        centers = []
        for kps in hist:
            hips = [self._kp(kps, i) for i in [11, 12]]
            hips = [h for h in hips if h]
            if hips:
                cx = np.mean([h[0] for h in hips])
                cy = np.mean([h[1] for h in hips])
                centers.append((cx, cy))
        if len(centers) >= 18:
            xs = [c[0] for c in centers]
            ys = [c[1] for c in centers]
            spread = ((max(xs)-min(xs))**2 + (max(ys)-min(ys))**2)**0.5
            return spread < 35
        return False

# ═══════════════════════════════════════════════════════════
# MOTEUR PRINCIPAL
# ═══════════════════════════════════════════════════════════
class SentinelProEngine:
    def __init__(self):
        print("[AI] Chargement modèles haute précision (Large)...", file=sys.stderr)
        
        # Fallbacks to 'm' if 'l' is missing (to prevent crashes on fresh install without downloading large weights immediately)
        person_model_path = CONFIG["model_person"]
        pose_model_path = CONFIG["model_pose"]
        if not os.path.exists(person_model_path):
            print("[AI] Modèle large non trouvé, téléchargement automatique par ultralytics...", file=sys.stderr)
            
        self.yolo_person = YOLO(person_model_path)
        self.yolo_pose = YOLO(pose_model_path)
        try:
            self.yolo_weapon = YOLO(CONFIG["model_weapon"])
        except:
            print("[AI] Warning: Weapon model not loaded.", file=sys.stderr)
            self.yolo_weapon = None

        try:
            from insightface.app import FaceAnalysis
            self.face_analyzer = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
            self.face_analyzer.prepare(ctx_id=-1, det_size=(320, 320))
            self.faces_enabled = True
        except:
            self.faces_enabled = False

        self.temporal = StrictTemporalFilter()
        self.violence = ViolenceAnalyzer()
        
        # Per-camera video buffers
        self.buffers = {}
        self.frame_id = 0
        print("[AI] ✅ Moteur Pro prêt — Précision maximale activée", file=sys.stderr)

    def process(self, camera_id: str, frame: np.ndarray, known_faces_data=None) -> dict:
        self.frame_id += 1
        
        if camera_id not in self.buffers:
            self.buffers[camera_id] = VideoBuffer(fps=8, seconds=CONFIG["clip_buffer_sec"])
        vid_buffer = self.buffers[camera_id]
        vid_buffer.add(frame)

        h, w = frame.shape[:2]
        result = {
            "frame_id": self.frame_id,
            "timestamp": datetime.now().isoformat(),
            "frame_size": [w, h],
            "persons": [], "weapons": [], "poses": [], "faces": [],
            "alerts": [] # requires_human will be injected by unifiedAI
        }

        # ── 1. PERSONNES ────────────────────────────────────────
        det = self.yolo_person(frame, conf=CONFIG["conf_person"], classes=[0], verbose=False, imgsz=640)[0]
        persons = []
        if det.boxes is not None:
            for i, box in enumerate(det.boxes):
                conf = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                persons.append({"track_id": i, "bbox": [x1, y1, x2, y2], "conf": round(conf, 3)})
        result["persons"] = persons

        # ── 2. ARMES ────────────────────────────────────────────
        if persons and self.yolo_weapon:
            w_det = self.yolo_weapon(frame, conf=CONFIG["conf_weapon"], verbose=False, imgsz=640)[0]
            weapons = []
            if w_det.boxes is not None:
                for box in w_det.boxes:
                    conf = float(box.conf[0])
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    cls_id = int(box.cls[0])
                    cls_name = self.yolo_weapon.names[cls_id] if hasattr(self.yolo_weapon, 'names') else "weapon"
                    wcx, wcy = (x1+x2)/2, (y1+y2)/2
                    near = any(p["bbox"][0]-80 < wcx < p["bbox"][2]+80 and p["bbox"][1]-80 < wcy < p["bbox"][3]+80 for p in persons)
                    if near:
                        weapons.append({"class": cls_name, "bbox": [x1, y1, x2, y2], "confidence": round(conf, 3)})
            
            result["weapons"] = weapons
            if self.temporal.update(f"weapon_{camera_id}", len(weapons)>0, CONFIG["frames_weapon"], CONFIG["cooldown_weapon"]):
                clip = vid_buffer.save_clip("WEAPON")
                result["alerts"].append({"type": "weapon_detected", "severity": "critical", "clip_path": clip})

        # ── 3. POSE + VIOLENCE ──────────────────────────────────
        if persons:
            pose_res = self.yolo_pose(frame, conf=CONFIG["conf_violence"], verbose=False, imgsz=640)[0]
            if pose_res.keypoints is not None and pose_res.keypoints.data is not None:
                for idx, kps_tensor in enumerate(pose_res.keypoints.data):
                    kps = kps_tensor.cpu().numpy()
                    behaviors = self.violence.update(idx, kps)
                    posture = "standing"
                    if behaviors.get("falling"): posture = "fallen"
                    elif behaviors.get("loitering"): posture = "crouching"
                    result["poses"].append({"track_id": idx, "posture": posture, "gesture": "unknown"})
                    
                    if self.temporal.update(f"fight_{camera_id}_{idx}", behaviors.get("fighting", False), CONFIG["frames_violence"], CONFIG["cooldown_violence"]):
                        clip = vid_buffer.save_clip("FIGHT")
                        result["alerts"].append({"type": "violence_detected", "severity": "critical", "clip_path": clip})
                    if self.temporal.update(f"fall_{camera_id}_{idx}", behaviors.get("falling", False), 6, 20):
                        clip = vid_buffer.save_clip("FALL")
                        result["alerts"].append({"type": "fall_detected", "severity": "high", "clip_path": clip})

        # ── 4. FACES ───────────────────────────────────────────
        if persons and self.faces_enabled and known_faces_data:
            try:
                faces = self.face_analyzer.get(frame)
                for face in faces:
                    emb = face.normed_embedding
                    if emb is None: continue
                    x1, y1, x2, y2 = map(int, face.bbox)
                    best_match, best_sim = None, 0.45
                    for kf in known_faces_data:
                        kf_emb = np.array(kf.get('embedding', []))
                        if len(kf_emb) == len(emb):
                            sim = np.dot(emb, kf_emb)
                            if sim > best_sim:
                                best_sim, best_match = sim, kf.get('name', 'Known')
                    
                    result["faces"].append({
                        "bbox": [x1, y1, x2, y2],
                        "is_known": best_match is not None,
                        "matched_name": best_match,
                        "similarity": round(float(best_sim), 3)
                    })
            except Exception as e:
                pass

        return result

# ==============================================================================
# Node.js ↔ Python Bridge Protocol
# ==============================================================================
_engine = None

def extract_embedding(jpeg_bytes, max_faces=1):
    if not _engine or not getattr(_engine, 'face_analyzer', None): return []
    nparr = np.frombuffer(jpeg_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None: return []
    try:
        faces = _engine.face_analyzer.get(frame)
        out = []
        for face in faces[:max_faces]:
            if face.normed_embedding is None: continue
            out.append({'bbox': face.bbox.tolist(), 'embedding': face.normed_embedding.tolist(), 'score': float(getattr(face, 'det_score', 0))})
        return out
    except:
        return []

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--init':
        _engine = SentinelProEngine()
        print(json.dumps({'status': 'ready'}))
        sys.exit(0)

    for line in sys.stdin:
        if line.startswith('\ufeff'): line = line[1:]
        line = line.strip()
        if not line: continue
        try: payload = json.loads(line)
        except Exception as e:
            print(json.dumps({'error': f'bad_json: {e}'}))
            sys.stdout.flush()
            continue

        if payload.get('cmd') == 'init':
            _engine = SentinelProEngine()
            print(json.dumps({'status': 'ready'}))
            sys.stdout.flush()
            continue
            
        if payload.get('cmd') == 'extract_embedding':
            try:
                b64 = payload.get('image', '')
                if ',' in b64: b64 = b64.split(',', 1)[1]
                faces = extract_embedding(base64.b64decode(b64), max_faces=payload.get('max_faces', 1))
                print(json.dumps({'id': payload.get('id'), 'result': {'faces': faces}}))
            except Exception as e:
                print(json.dumps({'id': payload.get('id'), 'error': str(e)}))
            sys.stdout.flush()
            continue

        req_id = payload.get('id')
        try:
            b64 = payload.get('image', '')
            if ',' in b64: b64 = b64.split(',', 1)[1]
            nparr = np.frombuffer(base64.b64decode(b64), np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if frame is None:
                print(json.dumps({'id': req_id, 'error': 'decode_failed'}))
            else:
                kf = payload.get('known_faces', [])
                cam_id = payload.get('camera_id', 'cam_default')
                result = _engine.process(cam_id, frame, kf)
                print(json.dumps({'id': req_id, 'result': result}))
        except Exception as e:
            import traceback
            print(json.dumps({'id': req_id, 'error': str(e), 'trace': traceback.format_exc()}))
        sys.stdout.flush()
