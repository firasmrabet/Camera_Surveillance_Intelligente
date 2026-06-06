"""
prepare_dataset.py
==================
Étape 1 du pipeline UCF-Crime : Extraction des squelettes (keypoints) à partir
des vidéos brutes du dataset UCF-Crimes/Videos/.

Pour chaque vidéo de la classe cible, on :
  1. Décode la vidéo avec OpenCV
  2. Toutes les FRAME_STEP images, on détecte les personnes + leurs 17 keypoints YOLOv8-pose
  3. On prend la personne avec la plus grande bounding box
  4. On normalise (x, y) par la taille de l'image
  5. On met à 0 les keypoints peu fiables (conf < MIN_CONF_KP)
  6. On découpe en fenêtres glissantes de SEQUENCE_LEN frames

Sortie (dans ./sentinel_data) :
  - X_sequences.npy   shape [N, SEQUENCE_LEN, 17, 3]   (float32)
  - y_labels.npy      shape [N]                        (int64)
  - stats.json        résumé par classe

Usage :
  python prepare_dataset.py
  python prepare_dataset.py --dataset ./UCF_Crimes/Videos --out ./sentinel_data
  python prepare_dataset.py --max-per-class 20    # debug rapide

Notes :
  - UCF-Crime n'a PAS de bounding boxes annotées. On utilise YOLOv8-pose pour les
    produire automatiquement. C'est la clé de l'approche.
  - Les classes "Abuse", "Arrest", "Arson", "Explosion", "RoadAccidents", "Vandalism"
    sont sciemment EXCLUES : peu utiles pour un système de sécurité résidentiel.
"""

import os
import sys
import json
import argparse
import time
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm
from ultralytics import YOLO


# ── CONFIG PAR DÉFAUT ─────────────────────────────────────────────────────
DEFAULT_DATASET = "./UCF_Crimes/Videos"
DEFAULT_OUTPUT  = "./sentinel_data"
SEQUENCE_LEN    = 30       # 30 frames par séquence
FRAME_STEP      = 5        # 1 frame sur 5 (vidéos UCF-Crime 30fps → 6 fps échantillonnés)
MIN_CONF_KP     = 0.40     # confiance min des keypoints
MIN_BBOX_AREA   = 800      # ignore les personnes trop petites (UCF-Crime = 240p)
IMGSZ           = 320      # résolution d'inférence pose (résolution native UCF-Crime)

# Classes utiles pour la sécurité résidentielle/commerciale.
# Adapation au VRAI dataset UCF-Crime :
#   - "Normal" est éclaté en 3 sous-dossiers, on les fusionne (label 0)
#   - Burglary est ajouté
#   - Les classes trop rares / non pertinentes (Abuse, Arrest, Arson,
#     Explosion, RoadAccidents, Vandalism) sont mappées à la même
#     classe "Other_anomaly" pour ne pas perdre l'info de déséquilibre.
TARGET_CLASSES = {
    # ── Normal ───────────────────────────────────────────────
    "Normal_Videos": 0,                                   # (label canonique)
    # Les 3 dossiers Normal réels sont fusionnés plus bas
    # ── Anomalies ciblées ────────────────────────────────────
    "Fighting":      1,
    "Assault":       2,
    "Robbery":       3,
    "Stealing":      4,
    "Shoplifting":   5,
    "Shooting":      6,
    "Burglary":      7,
    # ── Anomalies secondaires (regroupées) ───────────────────
    "Abuse":         8,
    "Arrest":        8,
    "Arson":         8,
    "Explosion":     8,
    "RoadAccidents": 8,
    "Vandalism":     8,
}
# Les 3 dossiers "Normal" du dataset UCF-Crime → tous → label 0
NORMAL_SUBFOLDERS = {
    "Training_Normal_Videos_Anomaly",
    "Testing_Normal_Videos_Anomaly",
    "z_Normal_Videos_event",
}


def parse_args():
    p = argparse.ArgumentParser(description="UCF-Crime keypoint extraction pipeline")
    p.add_argument("--dataset", default=DEFAULT_DATASET, help="Dossier UCF_Crimes/Videos")
    p.add_argument("--out",     default=DEFAULT_OUTPUT,  help="Dossier de sortie")
    p.add_argument("--max-per-class", type=int, default=0,
                   help="Limite le nombre de vidéos par classe (0 = toutes, utile pour debug)")
    p.add_argument("--device",  default="", help="Force device (cuda:0, cpu). Vide = auto")
    p.add_argument("--seq-len",  type=int, default=SEQUENCE_LEN)
    p.add_argument("--frame-step", type=int, default=FRAME_STEP)
    p.add_argument("--imgsz",   type=int, default=IMGSZ)
    p.add_argument("--batch-size", type=int, default=8,
                   help="Taille du batch pour YOLO (8 = bon compromis CPU)")
    p.add_argument("--min-quality", type=float, default=8.0,
                   help="Chap 11.2 : qualité minimale d'une séquence "
                        "(nb moyen de keypoints fiables / 17 par frame). "
                        "8.0 = garde les séquences avec ≥8/17 keypoints détectés. "
                        "0 = désactive le filtre.")
    p.add_argument("--merge-classes", action="store_true",
                   help="Chap 12.4 : fusionne les classes similaires pour améliorer la précision")
    return p.parse_args()


def sequence_quality(seq: np.ndarray, min_conf: float = 0.45) -> float:
    """
    Chap 11.2 — Mesure la qualité d'une séquence.

    seq : [T, 17, 3] — keypoints (x_norm, y_norm, conf)
    Retourne la MOYENNE de keypoints "fiables" (conf > min_conf) par frame.

    Pourquoi : YOLOv8-pose produit des keypoints peu fiables dans les vidéos
    sombres ou quand la personne est trop loin. Ces séquences de "zéros"
    polluent le dataset. Le seuil 8 (Chap 11.2) garantit qu'au moins la
    MOITIÉ des 17 keypoints sont détectés correctement sur la séquence.

    Une séquence à 0 = entièrement vide (personne non détectée).
    Une séquence à 17 = tous les keypoints détectés avec une conf > 0.45.
    """
    if seq is None or seq.size == 0:
        return 0.0
    reliable_per_frame = (seq[:, :, 2] > min_conf).sum(axis=1)  # [T]
    return float(reliable_per_frame.mean())


def is_quality_sequence(seq: np.ndarray, min_avg_reliable: float = 8.0, min_conf: float = 0.45) -> bool:
    """Retourne True si la séquence a au moins min_avg_reliable keypoints fiables/frame."""
    return sequence_quality(seq, min_conf) >= min_avg_reliable


def extract_keypoints_from_video(video_path, model, args):
    """
    Découpe une vidéo en séquences de SEQUENCE_LEN keypoints normalisés.

    OPTIMISATION CPU — VERSION STREAM :
      On lit les frames une par une depuis la vidéo, on accumule un batch
      de N frames, on l'envoie à YOLO, puis on libère. Mémoire O(batch)
      au lieu de O(vidéo) — indispensable pour les vidéos UCF-Crime
      de 2-5 min qui peuvent faire 1-2 GB en RAM.

    Le batch inference exploite le parallélisme PyTorch et est 5-10x
    plus rapide qu'inférer frame-par-frame.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return []

    h, w = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)), int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    if h == 0 or w == 0:
        h, w = 240, 320  # fallback UCF-Crime

    batch_size = max(1, int(getattr(args, "batch_size", 6)))
    batch = []
    all_kps = []
    frame_idx = 0

    def flush_batch(batch, all_kps):
        """Traite un batch de frames par YOLO et append les keypoints."""
        if not batch:
            return
        try:
            results = model(batch, conf=0.50, verbose=False, imgsz=args.imgsz)
        except Exception as e:
            print(f"  [!] YOLO batch error on {video_path.name}: {e}", file=sys.stderr, flush=True)
            for _ in batch:
                all_kps.append(np.zeros((17, 3), dtype=np.float32))
            return
        for res in results:
            if res.keypoints is None or len(res.keypoints.data) == 0:
                all_kps.append(np.zeros((17, 3), dtype=np.float32))
                continue
            best_idx, best_area = 0, 0
            for i, kps_t in enumerate(res.keypoints.data):
                xy = kps_t[:, :2].cpu().numpy()
                if len(xy) < 2:
                    continue
                x_min, y_min = xy.min(axis=0)
                x_max, y_max = xy.max(axis=0)
                area = max(0, x_max - x_min) * max(0, y_max - y_min)
                if area > best_area and area > MIN_BBOX_AREA:
                    best_area = area
                    best_idx = i
            if best_area == 0:
                all_kps.append(np.zeros((17, 3), dtype=np.float32))
                continue
            best_kps = res.keypoints.data[best_idx].cpu().numpy().astype(np.float32)
            if w > 0 and h > 0:
                best_kps[:, 0] /= w
                best_kps[:, 1] /= h
            mask = best_kps[:, 2] < MIN_CONF_KP
            best_kps[mask] = 0
            all_kps.append(best_kps)

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_idx % args.frame_step == 0:
                batch.append(frame)
                if len(batch) >= batch_size:
                    flush_batch(batch, all_kps)
                    batch = []
            frame_idx += 1
    finally:
        cap.release()

    # Traite le dernier batch partiel
    flush_batch(batch, all_kps)

    if not all_kps:
        return []

    # Découpe en fenêtres glissantes de SEQUENCE_LEN (stride = SEQUENCE_LEN//2)
    sequences = []
    stride = max(1, args.seq_len // 2)
    for i in range(0, len(all_kps) - args.seq_len + 1, stride):
        seq = np.array(all_kps[i: i + args.seq_len], dtype=np.float32)
        if seq.shape == (args.seq_len, 17, 3):
            sequences.append(seq)
    return sequences


def main():
    args = parse_args()
    dataset_path = Path(args.dataset)
    output_path  = Path(args.out)
    output_path.mkdir(parents=True, exist_ok=True)

    if not dataset_path.exists():
        sys.exit(f"[ERREUR] Dataset introuvable : {dataset_path.resolve()}\n"
                 f"Télécharge UCF-Crime et extrais-le dans : {dataset_path.parent.resolve()}")

    # Chap 12.4 — Option de fusion de classes (doit être déclarée avant le print)
    if args.merge_classes:
        # On construit le mapping cible ici, et on remappe TARGET_CLASSES juste après
        MERGE_MAP = {
            "Fighting": 1, "Assault": 1,   # → violence
            "Robbery": 2, "Stealing": 2, "Shoplifting": 2,  # → theft
            "Shooting": 3,                  # → weapon
            "Burglary": 4,                  # → intrusion
        }
        # Force l'override de TARGET_CLASSES AVANT le print ci-dessous
        TARGET_CLASSES_MERGED = {
            "Normal_Videos": 0,
            "Fighting": 1, "Assault": 1,
            "Robbery": 2, "Stealing": 2, "Shoplifting": 2,
            "Shooting": 3,
            "Burglary": 4,
            "Abuse": 5, "Arrest": 5, "Arson": 5, "Explosion": 5,
            "RoadAccidents": 5, "Vandalism": 5,
        }
        # On utilise globals() pour vraiment remplacer la constante du module
        globals()["TARGET_CLASSES"] = TARGET_CLASSES_MERGED
        print("\n[FUSION CLASSES] Mode activé — 6 classes fusionnées :")
        print("  → 0:Normal, 1:Violence (Fighting+Assault), 2:Theft (Robbery+Stealing+Shoplifting)")
        print("  → 3:Weapon (Shooting), 4:Intrusion (Burglary), 5:Other (Abuse/Arrest/...)\n")

    print("=" * 60)
    print("  SENTINEL AI — Préparation dataset UCF-Crime")
    print("=" * 60)
    print(f"  Dataset : {dataset_path.resolve()}")
    print(f"  Output  : {output_path.resolve()}")
    print(f"  Window  : {args.seq_len} frames (stride {args.frame_step})")
    print(f"  Classes : {list(TARGET_CLASSES.keys())}")
    print(f"  Quality filter : {args.min_quality} keypoints/frame (0=désactivé)")

    # Charge le modèle de pose UNE seule fois.
    # Ordre de préférence : yolov8m-pose (équilibre vitesse/qualité) puis l, s, n.
    print("\n[INIT] Chargement YOLOv8-pose…")
    try:
        # Le fichier de poids peut être dans ai_models/ ou racine.
        # Sur CPU on privilégie yolov8n-pose (6 MB) : ~10-15x plus rapide que yolov8l-pose
        # et largement suffisant pour UCF-Crime (vidéos basse résolution 240p).
        # Le LSTM entraîné avec ce modèle sera aussi performant pour la classification.
        candidates = [
            Path("../ai_models/yolov8n-pose.pt"),  # très rapide — défaut CPU
            Path("./ai_models/yolov8n-pose.pt"),
            Path("../ai_models/yolov8s-pose.pt"),
            Path("./ai_models/yolov8s-pose.pt"),
            Path("../ai_models/yolov8m-pose.pt"),  # bon compromis GPU
            Path("./ai_models/yolov8m-pose.pt"),
            Path("../ai_models/yolov8l-pose.pt"),  # plus précis mais lent CPU
            Path("./ai_models/yolov8l-pose.pt"),
            Path("yolov8n-pose.pt"),
            Path("yolov8l-pose.pt"),
        ]
        weights = next((str(p) for p in candidates if p.exists()), "yolov8n-pose.pt")
        model = YOLO(weights)
        print(f"[INIT] Modèle chargé : {weights}")
        # Si on est sur CPU, force imgsz petit pour éviter RAM saturée
        if not (hasattr(model, "device") and str(model.device).startswith("cuda")):
            if args.imgsz > 320:
                print(f"[INIT] CPU détecté — imgsz forcé à 320 (était {args.imgsz})")
                args.imgsz = 320
    except Exception as e:
        sys.exit(f"[ERREUR] Impossible de charger YOLOv8-pose : {e}")

    # Extraction
    all_sequences = []
    all_labels    = []
    stats         = {}
    total_t0 = time.time()

    # Construit la liste EFFECTIVE des sous-dossiers à scanner.
    # Gère le cas "Normal" éclaté en 3 dossiers dans UCF-Crime.
    classes_to_scan = []  # list[(label_id, label_name, subfolder_path)]
    for class_name, label_id in TARGET_CLASSES.items():
        if class_name == "Normal_Videos":
            # Cherche les 3 sous-dossiers Normal et les fusionne
            for sub in NORMAL_SUBFOLDERS:
                p = dataset_path / sub
                if p.exists():
                    classes_to_scan.append((0, "Normal", p))
            # Et le dossier "Normal_Videos" s'il existe aussi
            p = dataset_path / "Normal_Videos"
            if p.exists():
                classes_to_scan.append((0, "Normal", p))
        else:
            p = dataset_path / class_name
            if p.exists():
                classes_to_scan.append((label_id, class_name, p))

    if not classes_to_scan:
        sys.exit(f"\n[ERREUR] Aucun sous-dossier de classe trouvé dans {dataset_path.resolve()}\n"
                 f"Vérifie que le dataset est bien extrait à cet endroit.")

    for label_id, label_name, class_dir in classes_to_scan:
        # Dédoublonnage par nom (Windows est insensible à la casse pour les globs)
        seen = set()
        videos_unfiltered = []
        for pat in ("*.mp4", "*.avi", "*.MP4", "*.AVI", "*.mov", "*.MOV"):
            for v in class_dir.glob(pat):
                if v.name.lower() not in seen:
                    seen.add(v.name.lower())
                    videos_unfiltered.append(v)
        videos = sorted(videos_unfiltered)
        if args.max_per_class and args.max_per_class > 0:
            videos = videos[: args.max_per_class]
        print(f"\n[{label_name} ({class_dir.name})] {len(videos)} vidéos → label {label_id}", flush=True)

        class_seqs = 0
        class_filtered = 0
        t0 = time.time()
        for i, video in enumerate(videos, 1):
            try:
                seqs = extract_keypoints_from_video(video, model, args)
            except Exception as e:
                print(f"  [!] Crash sur {video.name}: {e}", file=sys.stderr, flush=True)
                continue
            for seq in seqs:
                # Chap 11.2 — Filtre qualité
                if args.min_quality > 0 and not is_quality_sequence(seq, args.min_quality):
                    class_filtered += 1
                    continue
                all_sequences.append(seq)
                all_labels.append(label_id)
                class_seqs += 1
            # Log manuel + flush pour visibilité en temps réel
            elapsed_v = time.time() - t0
            print(f"  [{i}/{len(videos)}] {video.name}: +{len(seqs)} seqs (total={class_seqs}, {elapsed_v:.0f}s)", flush=True)

        elapsed = time.time() - t0
        stats[label_name] = {
            "folder": class_dir.name,
            "sequences": class_seqs,
            "filtered_quality": class_filtered,
            "videos": len(videos),
            "seconds": round(elapsed, 1),
        }
        filter_pct = (100 * class_filtered / max(1, class_seqs + class_filtered))
        print(f"  → {class_seqs} séquences gardées, {class_filtered} filtrées ({filter_pct:.0f}%) en {elapsed:.0f}s", flush=True)

        # ── SAUVEGARDE INCRÉMENTALE après chaque classe ──
        # En cas de crash/timeout, on garde tout le travail accumulé.
        try:
            X_partial = np.array(all_sequences, dtype=np.float32)
            y_partial = np.array(all_labels,    dtype=np.int64)
            np.save(output_path / "X_sequences.npy", X_partial)
            np.save(output_path / "y_labels.npy",    y_partial)
            with open(output_path / "stats.json", "w", encoding="utf-8") as f:
                json.dump({
                    "classes":      TARGET_CLASSES,
                    "stats":        stats,
                    "total_sequences": int(len(X_partial)),
                    "shape_X":      list(X_partial.shape),
                    "shape_y":      list(y_partial.shape),
                    "config": {
                        "seq_len":     args.seq_len,
                        "frame_step":  args.frame_step,
                        "min_conf_kp": MIN_CONF_KP,
                    },
                    "extraction_seconds": round(time.time() - total_t0, 1),
                }, f, indent=2, ensure_ascii=False)
            print(f"  [SAVED] Cumul: {len(X_partial)} séquences (checkpoint)", flush=True)
        except Exception as e:
            print(f"  [!] Sauvegarde partielle échouée: {e}", file=sys.stderr, flush=True)

    if not all_sequences:
        sys.exit("\n[ERREUR] Aucune séquence extraite. Vérifie le dataset et les chemins.")

    # ── SAUVEGARDE ─────────────────────────────────────────────────────
    X = np.array(all_sequences, dtype=np.float32)
    y = np.array(all_labels,    dtype=np.int64)

    np.save(output_path / "X_sequences.npy", X)
    np.save(output_path / "y_labels.npy",    y)

    summary = {
        "classes":      TARGET_CLASSES,
        "stats":        stats,
        "total_sequences": int(len(X)),
        "shape_X":      list(X.shape),
        "shape_y":      list(y.shape),
        "config": {
            "seq_len":     args.seq_len,
            "frame_step":  args.frame_step,
            "min_conf_kp": MIN_CONF_KP,
        },
        "extraction_seconds": round(time.time() - total_t0, 1),
    }
    with open(output_path / "stats.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 60)
    print("  ✅ DATASET PRÊT")
    print("=" * 60)
    print(f"  Séquences totales : {len(X)}")
    print(f"  Shape X          : {X.shape}  (N × frames × keypoints × xy+conf)")
    print(f"  Shape y          : {y.shape}")
    print(f"  Distribution par label :")
    for idx in sorted(np.unique(y).tolist()):
        n = int((y == idx).sum())
        pct = 100.0 * n / max(1, len(y))
        # Retrouve le(s) nom(s) de classe(s) associé(s)
        names = [k for k, v in TARGET_CLASSES.items() if v == idx]
        label_text = "/".join(names) if names else f"class_{idx}"
        print(f"    {idx:2d} {label_text:30s} : {n:6d} ({pct:5.1f}%)")
    print(f"\n  Fichiers :")
    print(f"    {output_path / 'X_sequences.npy'}")
    print(f"    {output_path / 'y_labels.npy'}")
    print(f"    {output_path / 'stats.json'}")
    print(f"\n  Prochaine étape : python train_behavior_model.py")


if __name__ == "__main__":
    main()
