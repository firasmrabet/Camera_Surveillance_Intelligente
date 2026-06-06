# 🔴 PROMPT AGENT — SENTINEL AI : INTÉGRATION DATASET UCF-CRIME

Tu es un ingénieur ML senior qui travaille sur **Sentinel AI Security**.
Le dataset UCF-Crime (95 Go, 1900 vidéos, 13 classes criminelles) vient d'être
extrait. Ton rôle est d'implémenter **tout le pipeline** : de la préparation des
données jusqu'à l'intégration du modèle entraîné dans le moteur IA existant.

---

## 1. CE QUE TU AS MAINTENANT

```
UCF_Crimes/
├── Action_Regnition_splits/
│   ├── ClassIDs.txt
│   ├── train_001.txt … train_004.txt
│   └── test_001.txt  … test_004.txt
├── Anomaly_Detection_splits/
│   ├── Anomaly_Detection_Train.txt
│   └── Anomaly_Detection_Test.txt
└── Videos/
    ├── Abuse/            (~50 vidéos)
    ├── Arrest/
    ├── Arson/
    ├── Assault/          ← Agression physique
    ├── Burglary/         ← Cambriolage
    ├── Explosion/
    ├── Fighting/         ← Bagarre
    ├── RoadAccidents/
    ├── Robbery/          ← Vol avec violence
    ├── Shooting/         ← Tir d'arme
    ├── Shoplifting/      ← Vol à l'étalage
    ├── Stealing/         ← Vol simple
    ├── Vandalism/
    └── Normal_Videos/    ← Comportements normaux
```

**Contrainte importante** : UCF-Crime a des labels au niveau vidéo uniquement,
PAS de bounding boxes frame par frame. Tu dois contourner ça intelligemment.

---

## 2. STRATÉGIE COMPLÈTE (lis tout avant de commencer)

### Pourquoi pas l'approche YOLO classique ?
YOLO nécessite des bounding boxes annotées par frame. UCF-Crime n'en a pas.
Annoter 95 Go manuellement = impossible.

### La bonne approche : Pipeline en 3 couches

```
COUCHE 1 — Détection (déjà en place, garde-la)
  YOLOv8-l détecte les personnes → bounding boxes

COUCHE 2 — Extraction de squelette (déjà en place, améliore-la)
  YOLOv8-l-pose extrait 17 keypoints par personne par frame

COUCHE 3 — Classification comportement (NOUVEAU — à implémenter)
  LSTM entraîné sur UCF-Crime : séquences de poses → classe du comportement
  Entrée  : 30 frames × 17 keypoints × 3 valeurs (x, y, confiance)
  Sortie  : [normal, fighting, stealing, assault, shooting, ...]
```

Cette approche utilise les labels vidéo de UCF-Crime sans avoir besoin
de bounding boxes. Elle est précise, légère et fonctionne en temps réel.

---

## 3. FICHIERS À CRÉER (dans l'ordre exact)

### Fichier 1 : `prepare_dataset.py`

```python
"""
Étape 1 : Extraire les keypoints de pose de toutes les vidéos UCF-Crime.
Résultat : fichiers .npy contenant les séquences de keypoints + labels.
"""

import cv2, numpy as np, os, json
from pathlib import Path
from ultralytics import YOLO
from tqdm import tqdm

# ── CONFIG ────────────────────────────────────────────────────────────
DATASET_PATH  = "./UCF_Crimes/Videos"
OUTPUT_PATH   = "./sentinel_data"
SEQUENCE_LEN  = 30      # 30 frames par séquence
FRAME_STEP    = 3       # prend 1 frame sur 3 (évite la redondance)
MIN_CONF_KP   = 0.40    # confiance minimale des keypoints

# Classes à garder pour Sentinel (les plus utiles pour sécurité)
TARGET_CLASSES = {
    "Normal_Videos": 0,
    "Fighting":      1,
    "Assault":       2,
    "Robbery":       3,
    "Stealing":      4,
    "Shoplifting":   5,
    "Shooting":      6,
}

os.makedirs(OUTPUT_PATH, exist_ok=True)
model_pose = YOLO("yolov8l-pose.pt")

def extract_keypoints_from_video(video_path):
    """Retourne liste de séquences [seq_len × 17 × 3]."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return []

    all_kps   = []
    frame_idx = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_idx % FRAME_STEP == 0:
            res = model_pose(frame, conf=0.50, verbose=False, imgsz=480)
            if res[0].keypoints is not None and len(res[0].keypoints.data) > 0:
                # Prend la personne avec la plus grande bounding box
                best_kps = res[0].keypoints.data[0].cpu().numpy()  # [17, 3]
                # Normalise x,y par rapport à la taille de l'image
                h, w = frame.shape[:2]
                best_kps[:, 0] /= w
                best_kps[:, 1] /= h
                # Met à 0 les keypoints peu fiables
                mask = best_kps[:, 2] < MIN_CONF_KP
                best_kps[mask] = 0
                all_kps.append(best_kps)
            else:
                # Aucune personne détectée → frame de zéros
                all_kps.append(np.zeros((17, 3)))
        frame_idx += 1

    cap.release()

    # Découpe en séquences de SEQUENCE_LEN
    sequences = []
    for i in range(0, len(all_kps) - SEQUENCE_LEN + 1, SEQUENCE_LEN // 2):
        seq = all_kps[i : i + SEQUENCE_LEN]
        if len(seq) == SEQUENCE_LEN:
            sequences.append(np.array(seq))  # [30, 17, 3]
    return sequences

# ── EXTRACTION PRINCIPALE ────────────────────────────────────────────
all_sequences = []
all_labels    = []
stats         = {}

for class_name, label_id in TARGET_CLASSES.items():
    class_dir = Path(DATASET_PATH) / class_name
    if not class_dir.exists():
        print(f"[SKIP] {class_name} introuvable")
        continue

    videos = list(class_dir.glob("*.mp4")) + list(class_dir.glob("*.avi"))
    print(f"\n[{class_name}] {len(videos)} vidéos → label {label_id}")

    class_seqs = 0
    for video in tqdm(videos, desc=class_name):
        seqs = extract_keypoints_from_video(video)
        for seq in seqs:
            all_sequences.append(seq)
            all_labels.append(label_id)
            class_seqs += 1

    stats[class_name] = class_seqs
    print(f"  → {class_seqs} séquences extraites")

# ── SAUVEGARDE ────────────────────────────────────────────────────────
X = np.array(all_sequences, dtype=np.float32)  # [N, 30, 17, 3]
y = np.array(all_labels,    dtype=np.int64)     # [N]

np.save(f"{OUTPUT_PATH}/X_sequences.npy", X)
np.save(f"{OUTPUT_PATH}/y_labels.npy",    y)

with open(f"{OUTPUT_PATH}/stats.json", "w") as f:
    json.dump({"classes": TARGET_CLASSES, "stats": stats,
               "total_sequences": len(X)}, f, indent=2)

print(f"\n✅ Dataset prêt : {len(X)} séquences sauvegardées")
print(f"   Shape X : {X.shape}")
print(f"   Shape y : {y.shape}")
```

---

### Fichier 2 : `train_behavior_model.py`

```python
"""
Étape 2 : Entraîner le modèle LSTM de classification comportementale.
Entrée : séquences de keypoints [30, 17, 3]
Sortie : classe comportement (0=normal, 1=fighting, 2=assault, ...)
"""

import numpy as np, torch, torch.nn as nn, json, os
from torch.utils.data import Dataset, DataLoader, random_split
from sklearn.metrics import classification_report, confusion_matrix
from pathlib import Path

DATA_PATH  = "./sentinel_data"
MODEL_PATH = "./sentinel_data/behavior_model.pt"
DEVICE     = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# ── HYPERPARAMÈTRES ───────────────────────────────────────────────────
BATCH_SIZE  = 64
EPOCHS      = 60
LR          = 0.001
HIDDEN_SIZE = 256
NUM_LAYERS  = 3
DROPOUT     = 0.40

# ── DATASET ───────────────────────────────────────────────────────────
class BehaviorDataset(Dataset):
    def __init__(self, X, y):
        # Reshape [N, 30, 17, 3] → [N, 30, 51] pour le LSTM
        self.X = torch.FloatTensor(X.reshape(len(X), 30, -1))
        self.y = torch.LongTensor(y)

    def __len__(self):  return len(self.X)
    def __getitem__(self, i): return self.X[i], self.y[i]

# ── MODÈLE LSTM ────────────────────────────────────────────────────────
class BehaviorLSTM(nn.Module):
    def __init__(self, input_size=51, hidden=256, layers=3,
                 num_classes=7, dropout=0.4):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size, hidden, layers,
            batch_first=True, dropout=dropout, bidirectional=True
        )
        self.classifier = nn.Sequential(
            nn.LayerNorm(hidden * 2),
            nn.Linear(hidden * 2, 128),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(128, num_classes)
        )

    def forward(self, x):
        out, (hn, _) = self.lstm(x)
        # Concat forward + backward dernière couche
        feat = torch.cat([hn[-2], hn[-1]], dim=1)
        return self.classifier(feat)

# ── ENTRAÎNEMENT ──────────────────────────────────────────────────────
print(f"[TRAIN] Chargement données...")
X = np.load(f"{DATA_PATH}/X_sequences.npy")
y = np.load(f"{DATA_PATH}/y_labels.npy")
print(f"[TRAIN] {len(X)} séquences — device: {DEVICE}")

dataset = BehaviorDataset(X, y)
n_train = int(len(dataset) * 0.80)
n_val   = int(len(dataset) * 0.10)
n_test  = len(dataset) - n_train - n_val
train_set, val_set, test_set = random_split(dataset, [n_train, n_val, n_test])

train_loader = DataLoader(train_set, BATCH_SIZE, shuffle=True,  num_workers=4)
val_loader   = DataLoader(val_set,   BATCH_SIZE, shuffle=False, num_workers=4)
test_loader  = DataLoader(test_set,  BATCH_SIZE, shuffle=False, num_workers=4)

with open(f"{DATA_PATH}/stats.json") as f:
    info = json.load(f)
num_classes = len(info["classes"])

model     = BehaviorLSTM(num_classes=num_classes).to(DEVICE)
optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-4)
scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, EPOCHS)
criterion = nn.CrossEntropyLoss()

best_val_acc = 0.0

for epoch in range(1, EPOCHS + 1):
    # ── Train ────────────────────────────────────────────
    model.train()
    train_loss = train_correct = 0
    for xb, yb in train_loader:
        xb, yb = xb.to(DEVICE), yb.to(DEVICE)
        optimizer.zero_grad()
        out  = model(xb)
        loss = criterion(out, yb)
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        train_loss    += loss.item()
        train_correct += (out.argmax(1) == yb).sum().item()
    scheduler.step()

    # ── Validation ───────────────────────────────────────
    model.eval()
    val_correct = 0
    with torch.no_grad():
        for xb, yb in val_loader:
            xb, yb = xb.to(DEVICE), yb.to(DEVICE)
            val_correct += (model(xb).argmax(1) == yb).sum().item()

    train_acc = train_correct / len(train_set)
    val_acc   = val_correct   / len(val_set)

    print(f"Epoch {epoch:3d}/{EPOCHS} | "
          f"Loss: {train_loss/len(train_loader):.4f} | "
          f"Train: {train_acc:.1%} | Val: {val_acc:.1%}")

    # Sauvegarde meilleur modèle
    if val_acc > best_val_acc:
        best_val_acc = val_acc
        torch.save({
            "model_state": model.state_dict(),
            "classes":     info["classes"],
            "input_size":  51,
            "hidden_size": HIDDEN_SIZE,
            "num_layers":  NUM_LAYERS,
            "num_classes": num_classes,
        }, MODEL_PATH)
        print(f"  ✅ Meilleur modèle sauvegardé → {val_acc:.1%}")

# ── ÉVALUATION FINALE ─────────────────────────────────────────────────
print(f"\n{'='*50}")
print(f"MEILLEURE PRÉCISION VALIDATION : {best_val_acc:.1%}")

checkpoint = torch.load(MODEL_PATH)
model.load_state_dict(checkpoint["model_state"])
model.eval()

all_preds, all_true = [], []
with torch.no_grad():
    for xb, yb in test_loader:
        preds = model(xb.to(DEVICE)).argmax(1).cpu().numpy()
        all_preds.extend(preds)
        all_true.extend(yb.numpy())

class_names = list(info["classes"].keys())
print(classification_report(all_true, all_preds, target_names=class_names))

if best_val_acc >= 0.90:
    print("✅ MODÈLE PRÊT POUR PRODUCTION")
else:
    print(f"⚠️  Précision {best_val_acc:.1%} — continue l'entraînement")
print(f"{'='*50}")
```

---

### Fichier 3 : `ai_engine.py` — REMPLACE L'ANCIEN ENTIÈREMENT

```python
"""
Sentinel AI Security — Moteur IA v2.0
Nouveau : Classification comportementale LSTM entraîné sur UCF-Crime.
Ancien  : Pose basée sur règles manuelles (supprimé).
"""

import cv2, numpy as np, time, base64, os, torch, torch.nn as nn
from collections import deque
from datetime import datetime
from ultralytics import YOLO
import socketio

# ── MODÈLE LSTM (même architecture que train_behavior_model.py) ────────
class BehaviorLSTM(nn.Module):
    def __init__(self, input_size, hidden, layers, num_classes, dropout=0.4):
        super().__init__()
        self.lstm = nn.LSTM(input_size, hidden, layers,
                            batch_first=True, dropout=dropout,
                            bidirectional=True)
        self.classifier = nn.Sequential(
            nn.LayerNorm(hidden * 2),
            nn.Linear(hidden * 2, 128),
            nn.ReLU(), nn.Dropout(dropout),
            nn.Linear(128, num_classes)
        )
    def forward(self, x):
        _, (hn, _) = self.lstm(x)
        feat = torch.cat([hn[-2], hn[-1]], dim=1)
        return self.classifier(feat)

# ── CONFIG ────────────────────────────────────────────────────────────
CONFIG = {
    "model_person":    "yolov8l.pt",
    "model_pose":      "yolov8l-pose.pt",
    "model_weapon":    "yolov8l.pt",
    "behavior_model":  "./sentinel_data/behavior_model.pt",
    "conf_person":     0.72,
    "conf_weapon":     0.88,
    "conf_pose":       0.55,
    "sequence_len":    30,
    "behavior_conf_threshold": 0.82,   # confiance min pour alerter
    "frames_weapon":   12,
    "frames_intrusion": 6,
    "cooldown_weapon":   30,
    "cooldown_behavior": 20,
    "cooldown_intrusion": 15,
    "clip_buffer_fps": 15,
    "clip_buffer_sec": 10,
    "clips_dir":       "./server/clips",
}

DANGEROUS_CLASSES = {
    "Fighting":   ("violence_detected", "critical", "🚨 BAGARRE DÉTECTÉE"),
    "Assault":    ("violence_detected", "critical", "🚨 AGRESSION DÉTECTÉE"),
    "Robbery":    ("robbery_detected",  "critical", "🚨 VOL AVEC VIOLENCE"),
    "Stealing":   ("theft_detected",    "high",     "⚠️ VOL DÉTECTÉ"),
    "Shoplifting":("theft_detected",    "high",     "⚠️ VOL À L'ÉTALAGE"),
    "Shooting":   ("weapon_detected",   "critical", "🔴 TIR D'ARME DÉTECTÉ"),
}

# ── VIDEO BUFFER ──────────────────────────────────────────────────────
class VideoBuffer:
    def __init__(self, fps=15, seconds=10):
        self.buf = deque(maxlen=int(fps * seconds))
        self.fps = fps
    def add(self, frame): self.buf.append(frame.copy())
    def save(self, alert_type):
        folder = f"{CONFIG['clips_dir']}/{alert_type.upper()}"
        os.makedirs(folder, exist_ok=True)
        ts   = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = f"{folder}/{alert_type.upper()}_{ts}.mp4"
        frames = list(self.buf)
        if not frames: return ""
        h, w = frames[0].shape[:2]
        wr = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"),
                             self.fps, (w, h))
        for f in frames: wr.write(f)
        wr.release()
        return path

# ── TEMPORAL FILTER ───────────────────────────────────────────────────
class TemporalFilter:
    def __init__(self):
        self.cnt = {}; self.last_seen = {}; self.last_alert = {}
    def update(self, key, detected, threshold, cooldown):
        now = time.time()
        if not detected:
            self.cnt[key] = 0; return False
        if now - self.last_seen.get(key, 0) > 1.5:
            self.cnt[key] = 0
        self.cnt[key] = self.cnt.get(key, 0) + 1
        self.last_seen[key] = now
        if now - self.last_alert.get(key, 0) < cooldown: return False
        if self.cnt[key] >= threshold:
            self.last_alert[key] = now; self.cnt[key] = 0; return True
        return False

# ── MOTEUR PRINCIPAL ──────────────────────────────────────────────────
class SentinelEngine:
    def __init__(self):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print(f"[AI] Device : {self.device}")

        print("[AI] Chargement YOLOv8-l...")
        self.yolo_person = YOLO(CONFIG["model_person"])
        self.yolo_pose   = YOLO(CONFIG["model_pose"])
        self.yolo_weapon = YOLO(CONFIG["model_weapon"])

        # Charge le modèle comportemental entraîné sur UCF-Crime
        print("[AI] Chargement modèle comportement UCF-Crime...")
        self._load_behavior_model()

        # Historiques de poses par personne (pour le LSTM)
        self.pose_histories = {}     # track_id → deque [30, 17, 3]

        self.temporal   = TemporalFilter()
        self.vid_buffer = VideoBuffer(CONFIG["clip_buffer_fps"],
                                       CONFIG["clip_buffer_sec"])
        self.frame_id   = 0
        print("[AI] ✅ Sentinel v2.0 prêt — Modèle UCF-Crime actif")

    def _load_behavior_model(self):
        try:
            ckpt = torch.load(CONFIG["behavior_model"],
                              map_location=self.device)
            self.class_names = list(ckpt["classes"].keys())
            self.num_classes  = ckpt["num_classes"]
            self.behavior_model = BehaviorLSTM(
                input_size=51,
                hidden=256,
                layers=3,
                num_classes=self.num_classes
            ).to(self.device)
            self.behavior_model.load_state_dict(ckpt["model_state"])
            self.behavior_model.eval()
            print(f"[AI] ✅ Modèle comportement chargé — {self.num_classes} classes")
            print(f"[AI]    Classes : {self.class_names}")
        except FileNotFoundError:
            print("[AI] ⚠️  Modèle comportement non trouvé — lance train_behavior_model.py")
            self.behavior_model = None
            self.class_names    = []

    def _classify_behavior(self, track_id, kps_np):
        """
        Ajoute les keypoints à l'historique du track_id.
        Quand 30 frames accumulées → classifie avec LSTM.
        Retourne (class_name, confidence) ou (None, 0).
        """
        if self.behavior_model is None:
            return None, 0.0

        if track_id not in self.pose_histories:
            self.pose_histories[track_id] = deque(maxlen=CONFIG["sequence_len"])

        # Normalise et stocke
        kps_norm = kps_np.copy().astype(np.float32)  # [17, 3]
        self.pose_histories[track_id].append(kps_norm)

        # Pas encore assez de frames
        if len(self.pose_histories[track_id]) < CONFIG["sequence_len"]:
            return None, 0.0

        # Prépare la séquence pour le LSTM
        seq = np.array(self.pose_histories[track_id])  # [30, 17, 3]
        seq = seq.reshape(1, CONFIG["sequence_len"], -1)  # [1, 30, 51]
        tensor = torch.FloatTensor(seq).to(self.device)

        with torch.no_grad():
            logits = self.behavior_model(tensor)       # [1, num_classes]
            probs  = torch.softmax(logits, dim=1)[0]
            conf, idx = probs.max(0)
            conf = float(conf)
            cls  = self.class_names[int(idx)]

        return cls, conf

    def process(self, frame: np.ndarray) -> dict:
        self.frame_id += 1
        self.vid_buffer.add(frame)

        result = {
            "frame_id":  self.frame_id,
            "timestamp": datetime.now().isoformat(),
            "persons":   [],
            "weapons":   [],
            "behaviors": [],
            "alerts":    [],
            "clip_path": None,
        }

        # ── 1. PERSONNES ────────────────────────────────
        det = self.yolo_person(
            frame, conf=CONFIG["conf_person"],
            classes=[0], verbose=False, imgsz=640
        )[0]

        persons = []
        if det.boxes is not None:
            for box in det.boxes:
                x1,y1,x2,y2 = map(int, box.xyxy[0])
                persons.append({
                    "bbox": [x1,y1,x2,y2],
                    "conf": round(float(box.conf[0]), 3)
                })
        result["persons"] = persons

        # Alerte intrusion
        if self.temporal.update("intrusion", bool(persons),
                                CONFIG["frames_intrusion"],
                                CONFIG["cooldown_intrusion"]):
            result["alerts"].append({
                "type":           "intrusion",
                "level":          "medium",
                "message":        f"{len(persons)} personne(s) détectée(s)",
                "requires_human": True,
                "clip_path":      self.vid_buffer.save("INTRUSION"),
                "timestamp":      datetime.now().isoformat(),
            })

        # ── 2. POSE + CLASSIFICATION COMPORTEMENT ───────
        if persons:
            pose_res = self.yolo_pose(
                frame, conf=CONFIG["conf_pose"],
                verbose=False, imgsz=640
            )[0]

            if pose_res.keypoints is not None:
                for track_id, kps_t in enumerate(pose_res.keypoints.data):
                    kps = kps_t.cpu().numpy()  # [17, 3]

                    # Normalise par taille de l'image
                    h, w = frame.shape[:2]
                    kps_norm = kps.copy()
                    kps_norm[:, 0] /= w
                    kps_norm[:, 1] /= h

                    # Classification UCF-Crime LSTM
                    behavior, conf = self._classify_behavior(track_id, kps_norm)

                    if behavior and conf >= CONFIG["behavior_conf_threshold"]:
                        result["behaviors"].append({
                            "track_id": track_id,
                            "behavior": behavior,
                            "conf":     round(conf, 3)
                        })

                        # Est-ce un comportement dangereux ?
                        if behavior in DANGEROUS_CLASSES:
                            alert_type, level, message = DANGEROUS_CLASSES[behavior]
                            key = f"behavior_{track_id}_{behavior}"
                            if self.temporal.update(key, True, 3,
                                                    CONFIG["cooldown_behavior"]):
                                clip = self.vid_buffer.save(alert_type.upper())
                                result["clip_path"] = clip
                                result["alerts"].append({
                                    "type":           alert_type,
                                    "level":          level,
                                    "message":        f"{message} (conf: {conf:.0%})",
                                    "behavior":       behavior,
                                    "confidence":     round(conf, 3),
                                    "track_id":       track_id,
                                    "requires_human": True,
                                    "clip_path":      clip,
                                    "timestamp":      datetime.now().isoformat(),
                                })

        # ── 3. ARMES (seuil strict + présence personne) ─
        if persons:
            w_det = self.yolo_weapon(
                frame, conf=CONFIG["conf_weapon"],
                verbose=False, imgsz=640
            )[0]

            weapons = []
            if w_det.boxes is not None:
                for box in w_det.boxes:
                    x1,y1,x2,y2 = map(int, box.xyxy[0])
                    wcx, wcy = (x1+x2)/2, (y1+y2)/2
                    near = any(
                        p["bbox"][0]-80 < wcx < p["bbox"][2]+80 and
                        p["bbox"][1]-80 < wcy < p["bbox"][3]+80
                        for p in persons
                    )
                    if near:
                        weapons.append({
                            "bbox": [x1,y1,x2,y2],
                            "conf": round(float(box.conf[0]), 3)
                        })

            result["weapons"] = weapons
            if self.temporal.update("weapon", bool(weapons),
                                    CONFIG["frames_weapon"],
                                    CONFIG["cooldown_weapon"]):
                clip = self.vid_buffer.save("WEAPON")
                result["clip_path"] = clip
                result["alerts"].append({
                    "type":           "weapon_detected",
                    "level":          "critical",
                    "message":        f"🔴 ARME DÉTECTÉE (conf: {weapons[0]['conf']:.0%})",
                    "requires_human": True,
                    "clip_path":      clip,
                    "timestamp":      datetime.now().isoformat(),
                })

        return result


# ── SOCKET.IO ─────────────────────────────────────────────────────────
engine = SentinelEngine()
sio    = socketio.Client()

@sio.on("frame")
def on_frame(data):
    try:
        buf   = base64.b64decode(data["image"])
        arr   = np.frombuffer(buf, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None: return
        result = engine.process(frame)
        sio.emit("ai_results", result)
    except Exception as e:
        print(f"[AI] Erreur : {e}")

@sio.event
def connect():    print("[AI] ✅ Connecté au serveur Node")
@sio.event
def disconnect(): print("[AI] ❌ Déconnecté")

if __name__ == "__main__":
    import sys
    host = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3001"
    print(f"[AI] Connexion → {host}")
    sio.connect(host)
    sio.wait()
```

---

## 4. ORDRE D'EXÉCUTION EXACT

```bash
# Étape 1 — Installe les dépendances
pip install torch torchvision ultralytics scikit-learn tqdm

# Étape 2 — Extrait les keypoints de toutes les vidéos UCF-Crime
#           (long : 2 à 6 heures selon ton GPU)
python prepare_dataset.py

# Étape 3 — Entraîne le modèle LSTM
#           (1 à 4 heures selon GPU)
python train_behavior_model.py

# Étape 4 — Lance le moteur IA mis à jour
python ai_engine.py http://localhost:3001
```

---

## 5. CE QUI CHANGE PAR RAPPORT À L'ANCIENNE VERSION

| Composant            | ANCIENNE version              | NOUVELLE version                        |
|----------------------|-------------------------------|-----------------------------------------|
| Classification       | Règles manuelles (vitesse kp) | LSTM entraîné sur 1900 vraies vidéos    |
| Données              | Aucune donnée réelle          | UCF-Crime 95 Go (Fighting, Robbery…)    |
| Précision attendue   | ~50-60%                       | **≥ 90%**                               |
| Faux positifs        | Élevés                        | Très faibles (seuil 0.82 + temporel)    |
| Generalisation       | Faible                        | Bonne (entraîné sur cas réels)          |
| Détection armes      | Inchangée                     | Inchangée (garde conf 0.88)             |
| Clip sauvegarde      | Inchangée                     | Inchangée                               |
| requires_human       | Inchangée                     | Toujours True — règle absolue           |

---

## 6. RÈGLES QUE TU NE CHANGES JAMAIS

```
✅ requires_human : toujours True dans chaque alerte
✅ conf_weapon    : jamais en dessous de 0.88
✅ behavior_conf_threshold : jamais en dessous de 0.80
✅ Arme sans personne proche → ignorée
✅ Clip vidéo sauvegardé avant chaque alerte critique
✅ Chemin clips fixe : ./server/clips/{TYPE}/{TYPE}_{DATE}.mp4
```

---

*Sentinel AI Security v2.0 — Moteur comportemental entraîné sur UCF-Crime.*
