"""
ai_engine.py
============
Moteur d'IA Sentinel — version "Behavior LSTM" (UCF-Crime).

Drop-in replacement de ai_engine_pro.py. Mêmes modèles, même protocole
Node.js ↔ Python, mêmes sorties JSON. AJOUTE par-dessus :

  • Couche 3 — Classification comportementale par LSTM bi-directionnel
    entraînée sur UCF-Crime. Si le modèle n'existe pas, le moteur
    fonctionne en mode dégradé (heuristiques de violence uniquement).

Protocole (identique à ai_engine_pro.py) :
  - Entrée : JSONL sur stdin
    • {"cmd": "init"}                       → init et répond `{"status":"ready"}`
    • {"cmd": "extract_embedding", image, id, max_faces}
                                            → embedding facial
    • {id, image (base64 JPEG), known_faces, camera_id}
                                            → détection complète
  - Sortie : JSONL sur stdout
    • {id, result: {...}}                   → résultat de détection
    • {id, error: "..."}                    → erreur

Clés du `result` (schéma stable, rétro-compatible) :
  - persons, weapons, faces, frame_size, frame_id, timestamp
  - poses : [{ track_id, posture, gesture,
               behavior, behavior_conf, behavior_history }]
  - alerts : [{ type, severity, clip_path, behavior, behavior_conf }]

Choix de modèle LSTM :
  Chemin par défaut : <root>/sentinel_data/behavior_model.pt
  Variable d'env    : SENTINEL_BEHAVIOR_MODEL  (override chemin)
  Variable d'env    : SENTINEL_NO_LSTM=1       (désactive l'utilisation)

Classes prédites (ordre figé = ordre des labels dans prepare_dataset.py) :
  0 Normal            4 Stealing
  1 Fighting          5 Shoplifting
  2 Assault           6 Shooting
  3 Robbery           7 Burglary
                     8 Other_anomaly
"""

import sys
import os
import json
import base64
import time
import threading
from collections import deque
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO


# ═══════════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════════
ROOT_DIR    = Path(__file__).resolve().parent.parent
MODEL_DIR   = ROOT_DIR / "ai_models"
CLIPS_DIR   = ROOT_DIR / "server" / "clips"
BEHAVIOR_DEFAULT_PATH = ROOT_DIR / "sentinel_data" / "behavior_model.pt"

CONFIG = {
    "model_person":  str(MODEL_DIR / "yolov8n.pt"),
    "model_pose":    str(MODEL_DIR / "yolov8n-pose.pt"),
    "model_weapon":  str(MODEL_DIR / "weapons_yolov8s.pt"),

    "conf_person":   0.55,
    "conf_weapon":   0.90,  # Mode strict: increased confidence threshold
    "conf_violence": 0.60,

    "frames_weapon":     4,
    "frames_violence":   8,
    "frames_intrusion":  4,
    "frames_fall":       6,

    "clip_buffer_sec": 10,
    "clip_after_sec":  5,

    "cooldown_weapon":    120,
    "cooldown_violence":  20,
    "cooldown_intrusion": 15,
    "cooldown_fall":      20,
    "cooldown_behavior":  15,   # nouveau — comportement LSTM

    "clips_dir": str(CLIPS_DIR),
}

os.makedirs(CONFIG["clips_dir"], exist_ok=True)

# Lissage des prédictions comportementales
BEHAVIOR_SMOOTH_WIN = 5    # vote majoritaire sur les 5 dernières prédictions
BEHAVIOR_SEQ_LEN    = 30   # doit matcher train_behavior_model.SEQ_LEN
BEHAVIOR_FPS_TARGET = 8    # on n'ajoute qu'une frame sur N au buffer
BEHAVIOR_MIN_CONF   = 0.75 # STRICT MODE: seuil de confiance élevé pour lever une alerte


# ═══════════════════════════════════════════════════════════════════════
# BUFFER VIDÉO
# ═══════════════════════════════════════════════════════════════════════
class VideoBuffer:
    def __init__(self, fps=8, seconds=10):
        self.buffer = deque(maxlen=int(fps * seconds))
        self.fps = fps

    def add(self, frame: np.ndarray):
        self.buffer.append(frame.copy())

    def save_clip(self, alert_type: str, after_frames=None) -> str:
        after_frames = after_frames or []
        subfolder = os.path.join(CONFIG["clips_dir"], alert_type.upper())
        os.makedirs(subfolder, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{alert_type.upper()}_{timestamp}.mp4"
        filepath = os.path.join(subfolder, filename)
        frames = list(self.buffer) + after_frames
        if not frames:
            return ""
        h, w = frames[0].shape[:2]
        writer = cv2.VideoWriter(
            filepath, cv2.VideoWriter_fourcc(*"avc1"),
            self.fps, (w, h),
        )
        for f in frames:
            writer.write(f)
        writer.release()
        print(f"[CLIP] Sauvegardé : {filepath}", file=sys.stderr)
        return f"/clips/{alert_type.upper()}/{filename}"


# ═══════════════════════════════════════════════════════════════════════
# FILTRE TEMPOREL
# ═══════════════════════════════════════════════════════════════════════
class StrictTemporalFilter:
    def __init__(self):
        self.counters   = {}
        self.last_seen  = {}
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


# ═══════════════════════════════════════════════════════════════════════
# HEURISTIQUES VIOLENCE (fallback si pas de LSTM)
# ═══════════════════════════════════════════════════════════════════════
class HeuristicViolence:
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
        if idx >= len(kps):
            return None
        k = kps[idx]
        if float(k[2]) < 0.45:
            return None
        return float(k[0]), float(k[1])

    def _speed(self, hist, kp_idx, n=5):
        speeds = []
        for i in range(1, min(n, len(hist))):
            p1 = self._kp(hist[-i-1], kp_idx)
            p2 = self._kp(hist[-i],   kp_idx)
            if p1 and p2:
                speeds.append(((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2) ** 0.5)
        return float(np.mean(speeds)) if speeds else 0.0

    def _is_fighting(self, hist) -> bool:
        if len(hist) < 6:
            return False
        wrist_speed = max(self._speed(hist, 9), self._speed(hist, 10))
        elbow_speed = max(self._speed(hist, 7), self._speed(hist, 8))
        return wrist_speed > 40 and elbow_speed > 25

    def _is_falling(self, hist) -> bool:
        if len(hist) < 10:
            return False
        def body_ratio(kps):
            pts = [(float(k[0]), float(k[1])) for k in kps if float(k[2]) > 0.4]
            if len(pts) < 5:
                return None
            ys = [p[1] for p in pts]
            xs = [p[0] for p in pts]
            h = max(ys) - min(ys)
            w = max(xs) - min(xs)
            return h / (w + 1e-5)
        r_old = body_ratio(hist[-10])
        r_new = body_ratio(hist[-1])
        if r_old and r_new:
            return r_new < r_old * 0.50
        return False

    def _is_running(self, hist) -> bool:
        if len(hist) < 5:
            return False
        hip_speed = max(self._speed(hist, 11), self._speed(hist, 12))
        return hip_speed > 22

    def _is_loitering(self, hist) -> bool:
        if len(hist) < 20:
            return False
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
            spread = ((max(xs)-min(xs))**2 + (max(ys)-min(ys))**2) ** 0.5
            return spread < 35
        return False


# ═══════════════════════════════════════════════════════════════════════
# COUCHE 3 — CLASSIFIEUR COMPORTEMENTAL (LSTM)
# ═══════════════════════════════════════════════════════════════════════
class BehaviorClassifier:
    """
    Maintient, par caméra, un buffer glissant de keypoints (1 personne = 1 track).
    À chaque appel `update()`, on prédit la classe de comportement.

    Si le modèle LSTM n'est pas dispo, on retourne toujours
    behavior = "Normal" et behavior_conf = 0 → fallback transparent.
    """

    def __init__(self):
        self.model = None
        self.ckpt  = None
        self.device = "cpu"
        self.class_names = {}  # {int: str}
        self.seq_len = BEHAVIOR_SEQ_LEN
        self.kp_features = 3
        self.num_keypoints = 17
        self.lock = threading.Lock()
        self.buffers = {}  # camera_id -> { track_id -> deque[(17,3)] }
        self.vote_history = {}  # camera_id -> { track_id -> deque[int labels] }

        if os.environ.get("SENTINEL_NO_LSTM") == "1":
            print("[LSTM] Désactivé via SENTINEL_NO_LSTM=1", file=sys.stderr)
            return

        model_path = os.environ.get("SENTINEL_BEHAVIOR_MODEL", str(BEHAVIOR_DEFAULT_PATH))
        if not os.path.exists(model_path):
            print(f"[LSTM] Modèle comportemental absent : {model_path}", file=sys.stderr)
            print("[LSTM] → moteur en mode dégradé (heuristiques uniquement)", file=sys.stderr)
            return

        try:
            import torch
            self.torch = torch
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            self.ckpt = torch.load(model_path, map_location=self.device, weights_only=False)
            from torch import nn
            self.model = self._build_archi(self.ckpt, nn)
            self.model.load_state_dict(self.ckpt["state_dict"])
            self.model.eval()
            self.model.to(self.device)
            self.class_names = self.ckpt.get("class_names", {}) or self._default_class_names()
            self.seq_len = self.ckpt.get("seq_len", BEHAVIOR_SEQ_LEN)
            self.kp_features = self.ckpt.get("kp_features", 3)
            self.num_keypoints = self.ckpt.get("num_keypoints", 17)
            # Detection du mode merged : 6 classes (modele) mais 9 noms sauves
            num_ckpt = self.ckpt.get("num_classes", 0)
            if num_ckpt == 6 and len(self.class_names) >= 6:
                # Override avec le mapping merged canonique
                self.class_names = self._merged_class_names()
                print(f"[LSTM]   -> Mapping 6 classes fusionnees applique", file=sys.stderr)
            print(f"[LSTM] Modèle chargé : {model_path}", file=sys.stderr)
            print(f"[LSTM]   device       : {self.device}", file=sys.stderr)
            print(f"[LSTM]   classes      : {sorted(self.class_names.items())}", file=sys.stderr)
            print(f"[LSTM]   seq_len      : {self.seq_len}", file=sys.stderr)
        except Exception as e:
            print(f"[LSTM] Échec de chargement : {e}", file=sys.stderr)
            self.model = None

    @staticmethod
    def _default_class_names():
        return {
            0: "Normal", 1: "Fighting", 2: "Assault", 3: "Robbery",
            4: "Stealing", 5: "Shoplifting", 6: "Shooting",
            7: "Burglary", 8: "Other_anomaly",
        }

    @staticmethod
    def _merged_class_names():
        """Noms des 6 classes fusionnees (Chap 12.4)."""
        return {
            0: "Normal",
            1: "Violence",   # Fighting + Assault
            2: "Theft",      # Robbery + Stealing + Shoplifting
            3: "Weapon",     # Shooting
            4: "Intrusion",  # Burglary
            5: "Other",      # Abuse + Arrest + Arson + Explosion + RoadAccidents + Vandalism
        }

    def _build_archi(self, ckpt, nn):
        """Reconstruit le réseau depuis le checkpoint. Doit matcher train_behavior_model.py."""
        class BehaviorLSTM(nn.Module):
            def __init__(self, input_size, hidden_size, num_layers, num_classes, dropout, bidirectional):
                super().__init__()
                self.lstm = nn.LSTM(
                    input_size=input_size, hidden_size=hidden_size,
                    num_layers=num_layers, batch_first=True,
                    dropout=dropout if num_layers > 1 else 0.0,
                    bidirectional=bidirectional,
                )
                out_dim = hidden_size * (2 if bidirectional else 1)
                self.head = nn.Sequential(
                    nn.LayerNorm(out_dim),
                    nn.Linear(out_dim, 128),
                    nn.ReLU(inplace=True),
                    nn.Dropout(dropout),
                    nn.Linear(128, num_classes),
                )
                self.bidirectional = bidirectional

            def forward(self, x):
                out, _ = self.lstm(x)
                avg = out.mean(dim=1)
                mx, _ = out.max(dim=1)
                return self.head((avg + mx) / 2.0)

        return BehaviorLSTM(
            input_size=ckpt["input_size"],
            hidden_size=ckpt["hidden_size"],
            num_layers=ckpt["num_layers"],
            num_classes=ckpt["num_classes"],
            dropout=ckpt.get("dropout", 0.4),
            bidirectional=ckpt.get("bidirectional", True),
        )

    def update(self, camera_id: str, track_id: int, kps: np.ndarray) -> dict:
        """
        Ajoute la frame courante (17×3 keypoints) au buffer et prédit le comportement.
        Retourne : {"behavior": str, "conf": float, "smoothed": str, "history": list}
        """
        with self.lock:
            if self.model is None:
                return {"behavior": "Unknown", "conf": 0.0, "smoothed": "Unknown", "history": []}

            buf = self.buffers.setdefault(camera_id, {})
            votes = self.vote_history.setdefault(camera_id, {})

            dq = buf.setdefault(track_id, deque(maxlen=self.seq_len))
            dq.append(kps.copy())

            # Séquence pas encore complète
            if len(dq) < self.seq_len:
                return {
                    "behavior": "Warming", "conf": 0.0,
                    "smoothed": "Warming",
                    "history": [self.class_names.get(0, "Normal")] * len(dq),
                }

            # Construit le tenseur [1, T, K*F]
            seq = np.array(list(dq), dtype=np.float32)        # [T, 17, 3]
            seq = seq.reshape(self.seq_len, -1)                # [T, 51]
            x = self.torch.from_numpy(seq).unsqueeze(0).to(self.device)

            with self.torch.no_grad():
                logits = self.model(x)
                probs = self.torch.softmax(logits, dim=1)[0]
                conf, idx = self.torch.max(probs, dim=0)
                idx = int(idx)
                conf = float(conf)

            label_now = self.class_names.get(idx, f"class_{idx}")
            vq = votes.setdefault(track_id, deque(maxlen=BEHAVIOR_SMOOTH_WIN))
            vq.append(idx)
            # vote majoritaire
            counts = {}
            for v in vq:
                counts[v] = counts.get(v, 0) + 1
            maj_idx = max(counts, key=counts.get)
            label_smooth = self.class_names.get(maj_idx, f"class_{maj_idx}")

            return {
                "behavior": label_now,
                "conf": round(conf, 3),
                "smoothed": label_smooth,
                "history": [self.class_names.get(v, "?") for v in vq],
            }


# ═══════════════════════════════════════════════════════════════════════
# MOTEUR PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════
class SentinelBehaviorEngine:
    def __init__(self):
        print("[AI] Chargement Sentinel Behavior Engine…", file=sys.stderr)

        self.yolo_person = YOLO(CONFIG["model_person"])
        self.yolo_pose   = YOLO(CONFIG["model_pose"])
        try:
            self.yolo_weapon = YOLO(CONFIG["model_weapon"])
        except Exception:
            print("[AI] Weapon model non chargé.", file=sys.stderr)
            self.yolo_weapon = None

        try:
            from insightface.app import FaceAnalysis
            self.face_analyzer = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
            self.face_analyzer.prepare(ctx_id=-1, det_size=(320, 320))
            self.faces_enabled = True
        except Exception:
            self.faces_enabled = False

        self.temporal  = StrictTemporalFilter()
        self.violence  = HeuristicViolence()
        self.behavior  = BehaviorClassifier()

        self.buffers  = {}
        self.frame_id = 0

        flag = "Behavior-LSTM" if self.behavior.model is not None else "heuristic-only"
        print(f"[AI] ✅ Moteur prêt (mode: {flag})", file=sys.stderr)

    # ──────────────────── PIPELINE PRINCIPAL ────────────────────
    def process(self, camera_id: str, frame: np.ndarray, known_faces_data=None) -> dict:
        self.frame_id += 1

        if camera_id not in self.buffers:
            self.buffers[camera_id] = VideoBuffer(fps=8, seconds=CONFIG["clip_buffer_sec"])
        vid_buffer = self.buffers[camera_id]
        vid_buffer.add(frame)

        h, w = frame.shape[:2]
        result = {
            "frame_id":   self.frame_id,
            "timestamp":  datetime.now().isoformat(),
            "frame_size": [w, h],
            "persons":    [],
            "weapons":    [],
            "poses":      [],
            "faces":      [],
            "alerts":     [],
        }

        # ── 1. PERSONNES ───────────────────────────────────────
        det = self.yolo_person(frame, conf=CONFIG["conf_person"], classes=[0], verbose=False, imgsz=640)[0]
        persons = []
        if det.boxes is not None:
            for i, box in enumerate(det.boxes):
                conf = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                persons.append({"track_id": i, "bbox": [x1, y1, x2, y2], "conf": round(conf, 3)})
        result["persons"] = persons

        # ── 2. ARMES ───────────────────────────────────────────
        if persons and self.yolo_weapon:
            w_det = self.yolo_weapon(frame, conf=CONFIG["conf_weapon"], verbose=False, imgsz=640)[0]
            weapons = []
            if w_det.boxes is not None:
                # CROSS-VALIDATION : collecte les objets COCO inoffensifs (telephone, bouteille, etc.)
                # pour rejeter les faux-positifs armes qui chevauchent ces objets
                harmless_coco = set()  # IDs de classe COCO considérés inoffensifs
                HARMLESS_CLASSES = {'cell phone', 'bottle', 'remote', 'cup', 'mouse',
                                    'book', 'scissors', 'toothbrush', 'hair drier',
                                    'fork', 'knife', 'spoon'}  # "knife" COCO = couteau de cuisine
                harmless_boxes = []
                if det.boxes is not None:
                    for dbox in det.boxes:
                        dcls = self.yolo_person.names[int(dbox.cls[0])]
                        if dcls in HARMLESS_CLASSES:
                            dx1, dy1, dx2, dy2 = map(int, dbox.xyxy[0])
                            harmless_boxes.append((dcls, dx1, dy1, dx2, dy2))
                
                for box in w_det.boxes:
                    conf = float(box.conf[0])
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    cls_id = int(box.cls[0])
                    cls_name = self.yolo_weapon.names[cls_id] if hasattr(self.yolo_weapon, "names") else "weapon"
                    
                    # FILTRE TAILLE : rejeter les détections trop petites ou trop grandes
                    w_area = (x2 - x1) * (y2 - y1)
                    frame_area = frame.shape[0] * frame.shape[1]
                    area_ratio = w_area / max(frame_area, 1)
                    if area_ratio < 0.005 or area_ratio > 0.25:
                        continue  # trop petit (bruit) ou trop grand (faux positif)
                    
                    # CROSS-VALIDATION COCO : rejeter si un objet inoffensif chevauche la zone arme
                    is_harmless_overlap = False
                    wcx, wcy = (x1 + x2) / 2, (y1 + y2) / 2
                    for h_cls, hx1, hy1, hx2, hy2 in harmless_boxes:
                        # STRICT MODE: If the weapon center is anywhere near the phone/bottle box
                        # we reject it immediately. Increased margin from 30px to 60px to be very safe.
                        if hx1 - 60 < wcx < hx2 + 60 and hy1 - 60 < wcy < hy2 + 60:
                            is_harmless_overlap = True
                            print(f"[AI] Weapon '{cls_name}' ({conf:.0%}) REJECTED: overlaps COCO '{h_cls}'", file=sys.stderr)
                            break
                    if is_harmless_overlap:
                        continue
                    
                    near = any(
                        p["bbox"][0] - 80 < wcx < p["bbox"][2] + 80 and
                        p["bbox"][1] - 80 < wcy < p["bbox"][3] + 80
                        for p in persons
                    )
                    if near:
                        weapons.append({"class": cls_name, "bbox": [x1, y1, x2, y2], "confidence": round(conf, 3)})
            result["weapons"] = weapons
            if self.temporal.update(f"weapon_{camera_id}", len(weapons) > 0, CONFIG["frames_weapon"], CONFIG["cooldown_weapon"]):
                clip = vid_buffer.save_clip("WEAPON")
                result["alerts"].append({
                    "type": "weapon_detected", "severity": "critical",
                    "clip_path": clip,
                })

        # ── 3. POSE + VIOLENCE + LSTM BEHAVIOR ─────────────────
        if persons:
            pose_res = self.yolo_pose(frame, conf=CONFIG["conf_violence"], verbose=False, imgsz=640)[0]
            if pose_res.keypoints is not None and pose_res.keypoints.data is not None:
                for idx, kps_tensor in enumerate(pose_res.keypoints.data):
                    kps_raw = kps_tensor.cpu().numpy()  # [17, 3]
                    h_, w_ = frame.shape[:2]
                    kps_norm = kps_raw.copy()
                    if w_ > 0 and h_ > 0:
                        kps_norm[:, 0] /= w_
                        kps_norm[:, 1] /= h_

                    # Heuristiques (toujours dispos)
                    behaviors = self.violence.update(idx, kps_raw)
                    posture = "standing"
                    if behaviors.get("falling"):
                        posture = "fallen"
                    elif behaviors.get("loitering"):
                        posture = "crouching"

                    # Couche 3 — LSTM
                    beh_pred = self.behavior.update(camera_id, idx, kps_norm)
                    behavior_label   = beh_pred.get("smoothed", beh_pred.get("behavior", "Normal"))
                    behavior_conf    = beh_pred.get("conf", 0.0)
                    behavior_history = beh_pred.get("history", [])

                    pose_entry = {
                        "track_id":   idx,
                        "posture":    posture,
                        "gesture":    "unknown",
                        "behavior":   behavior_label,
                        "behavior_conf": round(behavior_conf, 3),
                        "behavior_history": behavior_history[-5:],
                    }
                    result["poses"].append(pose_entry)

                    # Alertes heuristiques
                    if self.temporal.update(f"fight_{camera_id}_{idx}", behaviors.get("fighting", False), CONFIG["frames_violence"], CONFIG["cooldown_violence"]):
                        clip = vid_buffer.save_clip("FIGHT")
                        result["alerts"].append({
                            "type": "violence_detected", "severity": "critical",
                            "clip_path": clip,
                            "behavior": "Fighting", "behavior_conf": behavior_conf,
                        })
                    if self.temporal.update(f"fall_{camera_id}_{idx}", behaviors.get("falling", False), CONFIG["frames_fall"], CONFIG["cooldown_fall"]):
                        clip = vid_buffer.save_clip("FALL")
                        result["alerts"].append({
                            "type": "fall_detected", "severity": "high",
                            "clip_path": clip,
                            "behavior": "Falling", "behavior_conf": behavior_conf,
                        })

                    # Alerte LSTM (comportement != Normal et conf > seuil)
                    if (
                        self.behavior.model is not None
                        and behavior_label not in ("Normal", "Warming", "Unknown")
                        and behavior_conf >= BEHAVIOR_MIN_CONF
                    ):
                        sev = "critical" if behavior_label in ("Fighting", "Assault", "Robbery", "Shooting") else "high"
                        key = f"lstm_{camera_id}_{behavior_label}"
                        if self.temporal.update(key, True, 3, CONFIG["cooldown_behavior"]):
                            clip = vid_buffer.save_clip(f"BEHAVIOR_{behavior_label.upper()}")
                            result["alerts"].append({
                                "type": f"behavior_{behavior_label.lower()}",
                                "severity": sev,
                                "clip_path": clip,
                                "behavior": behavior_label,
                                "behavior_conf": round(behavior_conf, 3),
                            })

        # ── 4. FACES ───────────────────────────────────────────
        if persons and self.faces_enabled and known_faces_data:
            try:
                faces = self.face_analyzer.get(frame)
                for face in faces:
                    emb = face.normed_embedding
                    if emb is None:
                        continue
                    x1, y1, x2, y2 = map(int, face.bbox)
                    best_match, best_sim = None, 0.45
                    for kf in known_faces_data:
                        kf_emb = np.array(kf.get("embedding", []))
                        if len(kf_emb) == len(emb):
                            sim = float(np.dot(emb, kf_emb))
                            if sim > best_sim:
                                best_sim, best_match = sim, kf.get("name", "Known")
                    result["faces"].append({
                        "bbox":         [x1, y1, x2, y2],
                        "is_known":     best_match is not None,
                        "matched_name": best_match,
                        "similarity":   round(best_sim, 3),
                    })
            except Exception:
                pass

        return result


# ═══════════════════════════════════════════════════════════════════════
# BRIDGE — Node.js ↔ Python
# ═══════════════════════════════════════════════════════════════════════
_engine = None
_engine_lock = threading.Lock()


def extract_embedding(jpeg_bytes, max_faces=1):
    if not _engine or not getattr(_engine, "face_analyzer", None):
        return []
    nparr = np.frombuffer(jpeg_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        return []
    try:
        faces = _engine.face_analyzer.get(frame)
        out = []
        for face in faces[:max_faces]:
            if face.normed_embedding is None:
                continue
            out.append({
                "bbox":      face.bbox.tolist(),
                "embedding": face.normed_embedding.tolist(),
                "score":     float(getattr(face, "det_score", 0)),
            })
        return out
    except Exception:
        return []


def _handle(payload: dict) -> dict:
    """Exécute une commande et retourne le dict JSON sérialisable à imprimer."""
    global _engine
    cmd = payload.get("cmd")

    if cmd == "init":
        with _engine_lock:
            if _engine is None:
                _engine = SentinelBehaviorEngine()
        return {"status": "ready"}

    if cmd == "extract_embedding":
        b64 = payload.get("image", "")
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        try:
            faces = extract_embedding(base64.b64decode(b64), max_faces=payload.get("max_faces", 1))
            return {"id": payload.get("id"), "result": {"faces": faces}}
        except Exception as e:
            return {"id": payload.get("id"), "error": str(e)}

    # Sinon : frame de détection standard
    req_id = payload.get("id")
    try:
        with _engine_lock:
            if _engine is None:
                _engine = SentinelBehaviorEngine()
            b64 = payload.get("image", "")
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            nparr = np.frombuffer(base64.b64decode(b64), np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                return {"id": req_id, "error": "decode_failed"}
            kf     = payload.get("known_faces", [])
            cam_id = payload.get("camera_id", "cam_default")
            result = _engine.process(cam_id, frame, kf)
            return {"id": req_id, "result": result}
    except Exception as e:
        import traceback
        return {"id": req_id, "error": str(e), "trace": traceback.format_exc()}


def main():
    # Mode --init : pré-charge et affiche "ready", puis exit (test rapide)
    if len(sys.argv) > 1 and sys.argv[1] == "--init":
        _handle({"cmd": "init"})
        return

    print("[AI] Sentinel Behavior Engine — prêt (stdin/stdout JSONL)", file=sys.stderr)
    for line in sys.stdin:
        if line.startswith("\ufeff"):
            line = line[1:]
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except Exception as e:
            print(json.dumps({"error": f"bad_json: {e}"}))
            sys.stdout.flush()
            continue
        out = _handle(payload)
        print(json.dumps(out))
        sys.stdout.flush()


if __name__ == "__main__":
    main()
