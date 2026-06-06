"""
test_live_v2.py
================
Test live du pipeline AI v2 (LSTM) sur une vidéo UCF-Crime.
- Charge une vidéo au hasard dans le dataset
- YOLOv8-pose pour extraire les keypoints
- SequenceBuffer -> LSTM -> vote majoritaire
- Affiche les predictions en temps réel dans le terminal
"""
import os
import sys
import time
import random
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

# Force l'utilisation du modele v2
os.environ.setdefault(
    "SENTINEL_BEHAVIOR_MODEL",
    str(ROOT.parent / "sentinel_data" / "behavior_model.pt"),
)

import cv2
import numpy as np
from ultralytics import YOLO

from ai_engine import BehaviorClassifier


def list_videos(dataset_dir: Path):
    """Liste tous les .mp4 du dataset, classes prises en charge."""
    classes = ["Fighting", "Robbery", "Stealing", "Shoplifting", "Shooting",
               "Burglary", "Abuse", "Arrest", "Arson", "Explosion",
               "RoadAccidents", "Vandalism", "Normal_Videos"]
    found = []
    for cls in classes:
        cls_dir = dataset_dir / cls
        if cls_dir.exists():
            for v in cls_dir.glob("*.mp4"):
                found.append((cls, v))
    # Aussi chercher dans les sous-dossiers de Normal (3 sous-dossiers)
    for sub in ["Training_Normal_Videos_Anomaly",
                "Testing_Normal_Videos_Anomaly",
                "z_Normal_Videos_event"]:
        sub_dir = dataset_dir / sub
        if sub_dir.exists():
            for v in sub_dir.glob("*.mp4"):
                found.append(("Normal", v))
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=r"C:\Users\Mrabet\Desktop\UCF_Crimes\UCF_Crimes\Videos")
    ap.add_argument("--class",   dest="target_class", default=None,
                    help="Si specifie, ne prend que cette classe (sinon random)")
    ap.add_argument("--frames",  type=int, default=200,
                    help="Nombre de frames a analyser (defaut 200 = 8s @25fps)")
    ap.add_argument("--yolo",    default=str(ROOT.parent / "ai_models" / "yolov8n-pose.pt"))
    ap.add_argument("--conf",    type=float, default=0.25,
                    help="Seuil de confiance keypoints (defaut 0.25 - plus permissif que training)")
    args = ap.parse_args()

    dataset_dir = Path(args.dataset)
    if not dataset_dir.exists():
        sys.exit(f"Dataset introuvable : {dataset_dir}")

    print("=" * 70)
    print("  SENTINEL AI - TEST LIVE v2 (LSTM 6 classes fusionnees)")
    print("=" * 70)

    # 1. Charger le classifieur
    print("\n[1/3] Chargement du classifieur LSTM...")
    clf = BehaviorClassifier()
    print(f"      Classes: {clf.class_names}")
    print(f"      Seq len: {clf.seq_len}")

    # 2. Charger YOLO
    print(f"\n[2/3] Chargement YOLO pose: {args.yolo}")
    if not Path(args.yolo).exists():
        sys.exit(f"YOLO model introuvable : {args.yolo}")
    yolo = YOLO(args.yolo)
    yolo.to("cpu")

    # 3. Trouver une vidéo
    print(f"\n[3/3] Recherche d'une vidéo dans {dataset_dir}...")
    videos = list_videos(dataset_dir)
    if not videos:
        sys.exit("Aucune vidéo trouvée dans le dataset.")

    if args.target_class:
        videos = [v for v in videos if v[0].lower() == args.target_class.lower()]
        if not videos:
            sys.exit(f"Aucune vidéo pour la classe '{args.target_class}'")
    chosen_class, chosen_path = random.choice(videos)
    print(f"      Classe: {chosen_class}")
    print(f"      Video : {chosen_path.name}")
    print(f"      Frames: {args.frames}")

    # 4. Ouvrir la vidéo
    cap = cv2.VideoCapture(str(chosen_path))
    if not cap.isOpened():
        sys.exit(f"Impossible d'ouvrir {chosen_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"      FPS: {fps:.1f}, total frames: {total}")

    # 5. Boucle d'inférence
    print("\n" + "=" * 70)
    print(f"  INFERENCE LIVE  ({args.frames} frames)")
    print("=" * 70)
    print(f"  {'Frame':>5} | {'Person':>6} | {'Behavior':<15} | {'Conf':>5} | {'Smoothed':<15} | Latence")
    print("  " + "-" * 70)

    last_preds = []  # pour stats finales
    t_global = time.time()
    n_with_poses = 0
    n_detections = 0

    for frame_idx in range(args.frames):
        ret, frame = cap.read()
        if not ret:
            print(f"\n  (fin de vidéo à frame {frame_idx})")
            break

        t0 = time.time()
        results = yolo(frame, conf=args.conf, verbose=False)[0]
        t_yolo = (time.time() - t0) * 1000

        # Pour chaque personne détectée, extraire les keypoints et prédire
        if results.keypoints is not None and len(results.keypoints) > 0:
            n_with_poses += 1
            for person_idx, kps in enumerate(results.keypoints):
                # kps.xy : (17, 2) ; kps.conf : (17,)
                if hasattr(kps, 'conf') and kps.conf is not None:
                    confs = kps.conf.cpu().numpy().reshape(-1)
                else:
                    confs = np.ones(17) * 0.5

                xy = kps.xy.cpu().numpy().reshape(17, 2)

                # Normaliser [0, 1] par les dimensions de l'image
                h, w = frame.shape[:2]
                xy_norm = xy.copy()
                xy_norm[:, 0] = np.clip(xy_norm[:, 0] / w, 0, 1)
                xy_norm[:, 1] = np.clip(xy_norm[:, 1] / h, 0, 1)

                # Construire [17, 3] : x, y, conf
                kp_17x3 = np.column_stack([xy_norm, confs]).astype(np.float32)

                # Filtrer si trop peu de keypoints
                # Note: YOLO retourne souvent confs=0 si non disponible
                # On considere fiable un keypoint si conf>seuil OU si xy != (0,0)
                valid = (confs > args.conf) | ((xy[:, 0] > 0) & (xy[:, 1] > 0))
                reliable = int(valid.sum())
                if reliable < 8:
                    # Pas assez de keypoints valides
                    continue

                n_detections += 1
                t1 = time.time()
                res = clf.update("live_test", person_idx, kp_17x3)
                t_pred = (time.time() - t1) * 1000

                behavior = res["behavior"]
                smoothed = res["smoothed"]
                conf_val = res["conf"]
                last_preds.append((behavior, smoothed, conf_val))

                # Print toutes les 10 frames ou si conf > 0.7
                if frame_idx % 10 == 0 or (conf_val > 0.5 and behavior != "Warming"):
                    print(f"  {frame_idx:>5} | {person_idx:>6} | {behavior:<15} | "
                          f"{conf_val:>5.2f} | {smoothed:<15} | "
                          f"YOLO={t_yolo:>4.0f}ms LSTM={t_pred:>4.0f}ms")
        else:
            if frame_idx % 30 == 0:
                print(f"  {frame_idx:>5} | (no person detected)")

    cap.release()
    total_t = (time.time() - t_global)

    # 6. Résumé
    print("\n" + "=" * 70)
    print("  RESUME")
    print("=" * 70)
    print(f"  Vraie classe       : {chosen_class}")
    print(f"  Frames analysées   : {args.frames}")
    print(f"  Frames avec poses  : {n_with_poses}")
    print(f"  Predictions LSTM   : {n_detections}")
    print(f"  Temps total        : {total_t:.1f}s ({args.frames/total_t:.1f} fps)")

    if last_preds:
        from collections import Counter
        c_behavior = Counter(p[0] for p in last_preds)
        c_smoothed = Counter(p[1] for p in last_preds)
        print(f"\n  Distribution 'behavior' (instant):")
        for k, v in c_behavior.most_common():
            print(f"    {k:<20} {v:>4} ({100*v/n_detections:.1f}%)")
        print(f"\n  Distribution 'smoothed' (vote majoritaire):")
        for k, v in c_smoothed.most_common():
            print(f"    {k:<20} {v:>4} ({100*v/n_detections:.1f}%)")
        maj_smoothed = c_smoothed.most_common(1)[0][0]
        print(f"\n  >>> Prediction majoritaire : {maj_smoothed}")
        print(f"  >>> Vraie classe           : {chosen_class}")
        if maj_smoothed in chosen_class or chosen_class in maj_smoothed:
            print(f"  >>> MATCH OK !")
        else:
            print(f"  >>> Pas de match exact (acceptable : classes fusionnees)")
    else:
        print("\n  Aucune prediction generee (video sans personne detectee).")


if __name__ == "__main__":
    main()
