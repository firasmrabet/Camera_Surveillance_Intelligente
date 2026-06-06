"""
fine_tune.py
============
Chap 13.2 — Fine-tuning sans repartir de zéro.

Quand on a de NOUVELLES données (clips terrain, nouvelles classes, etc.) :
  - On charge le modèle existant
  - On continue l'entraînement avec un learning rate 10× plus bas
  - Le modèle intègre les nouvelles infos SANS oublier ce qu'il a appris

Cas d'usage typiques :
  1. Collecter les clips confirmés/rejetés par l'opérateur pendant 1 semaine
  2. Extraire les keypoints de ces nouveaux clips (réutiliser prepare_dataset.py)
  3. Combiner avec X_sequences.npy existant
  4. Lancer ce script : fine-tuning rapide (20-30 epochs) avec LR bas

Usage :
  # Fine-tuner avec un dataset étendu (X_combined.npy / y_combined.npy)
  python fine_tune.py --data ./sentinel_data --epochs 20 --lr 0.0001

  # Fine-tuner avec seulement les nouveaux clips
  python fine_tune.py --pretrained ./sentinel_data/behavior_model.pt \
                      --data ./sentinel_data --epochs 20 --lr 0.0001
"""

import os
import sys
import json
import argparse
import time
from datetime import datetime
from pathlib import Path
from collections import Counter

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
from sklearn.utils.class_weight import compute_class_weight

# Réutilise le dataset et l'augmentation de train_behavior_model
from train_behavior_model import (
    BehaviorLSTM,
    AugmentedSequenceDataset,
    SEQ_LEN, NUM_KP, KP_FEATURES,
)


def parse_args():
    p = argparse.ArgumentParser(description="Fine-tune Behavior LSTM (Chap 13.2)")
    p.add_argument("--data",        default="./sentinel_data", help="Dossier avec X_sequences.npy et y_labels.npy")
    p.add_argument("--pretrained",  default="", help="Chemin du modèle pré-entraîné (défaut: behavior_model.pt du dossier data)")
    p.add_argument("--out",         default="", help="Sortie (défaut: <data>/behavior_model.pt)")
    p.add_argument("--epochs",      type=int,   default=20, help="Nombre d'epochs (20-30 pour fine-tuning)")
    p.add_argument("--lr",          type=float, default=1e-4, help="LR 10× plus bas qu'à l'init")
    p.add_argument("--batch",       type=int,   default=32)
    p.add_argument("--patience",    type=int,   default=5, help="Early stopping agressif")
    p.add_argument("--no-augment",  action="store_true", help="Pas d'augmentation (utile si dataset déjà étendu)")
    p.add_argument("--freeze-lstm", action="store_true", help="Gèle les poids LSTM (entraîne seulement la tête)")
    p.add_argument("--version-tag", default="", help="Tag de version pour l'archive")
    p.add_argument("--cpu",         action="store_true")
    return p.parse_args()


def main():
    args = parse_args()
    data_path = Path(args.data)
    out_path  = Path(args.out) if args.out else data_path / "behavior_model.pt"
    pretrained_path = Path(args.pretrained) if args.pretrained else data_path / "behavior_model.pt"

    if not pretrained_path.exists():
        sys.exit(f"[ERREUR] Modèle pré-entraîné introuvable : {pretrained_path}\n"
                 f"Lance d'abord train_behavior_model.py pour créer un modèle de base.")

    device = torch.device(
        "cuda" if torch.cuda.is_available() and not args.cpu else "cpu"
    )
    print("=" * 60)
    print("  SENTINEL AI — Fine-tuning (Chap 13.2)")
    print("=" * 60)
    print(f"  Device     : {device}")
    print(f"  Data       : {data_path.resolve()}")
    print(f"  Pretrained : {pretrained_path.resolve()}")
    print(f"  Output     : {out_path.resolve()}")
    print(f"  LR         : {args.lr} (10× plus bas que l'init 1e-3)")

    # ── Charge le checkpoint pré-entraîné ──────────────────────────────
    print("\n[LOAD] Chargement du modèle pré-entraîné…")
    ckpt = torch.load(pretrained_path, map_location=device, weights_only=False)
    print(f"  → epoch={ckpt.get('epoch', '?')} val_loss={ckpt.get('best_val_loss', '?'):.4f} tag={ckpt.get('tag', '?')}")
    print(f"  → classes={list(ckpt.get('class_names', {}).values())}")

    # Reconstruit le modèle avec la MÊME architecture que le checkpoint
    model = BehaviorLSTM(
        input_size=ckpt["input_size"],
        hidden_size=ckpt["hidden_size"],
        num_layers=ckpt["num_layers"],
        num_classes=ckpt["num_classes"],
        dropout=ckpt.get("dropout", 0.4),
        bidirectional=ckpt.get("bidirectional", True),
    ).to(device)
    model.load_state_dict(ckpt["state_dict"])
    n_params = sum(p.numel() for p in model.parameters())
    print(f"  → {n_params:,} paramètres chargés")

    # Option : geler le LSTM (entraîne seulement la tête MLP)
    if args.freeze_lstm:
        print("  → LSTM gelé (seule la tête MLP est entraînée)")
        for name, p in model.named_parameters():
            if "lstm" in name:
                p.requires_grad = False

    # ── Charge les données ────────────────────────────────────────────
    X_path = data_path / "X_sequences.npy"
    y_path = data_path / "y_labels.npy"
    if not X_path.exists() or not y_path.exists():
        sys.exit(f"[ERREUR] Fichiers manquants dans {data_path}.")

    print(f"\n[LOAD] Chargement des données {X_path.name}…")
    X = np.load(X_path, mmap_mode="r")
    y = np.load(y_path)
    X = np.array(X, dtype=np.float32).reshape(len(X), SEQ_LEN, -1)
    print(f"  → X.shape={X.shape}  y.shape={y.shape}")
    print(f"  → distribution: {dict(Counter(y.tolist()))}")

    # Vérifie la compatibilité des dimensions
    if X.shape[-1] != ckpt["input_size"]:
        sys.exit(f"[ERREUR] Le dataset a input_size={X.shape[-1]} mais le "
                 f"modèle attend {ckpt['input_size']}.\n"
                 f"Tu as probablement changé seq_len ou num_keypoints.\n"
                 f"Pour fine-tuner, garde les mêmes dimensions que le modèle pré-entraîné.")

    # Split train/val avec stratification
    X_tr, X_va, y_tr, y_va = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y,
    )

    # Class weights
    classes = np.unique(y)
    cw = compute_class_weight("balanced", classes=classes, y=y_tr)
    cw_tensor = torch.tensor(cw, dtype=torch.float32, device=device)

    # Datasets
    ds_tr = AugmentedSequenceDataset(X_tr, y_tr.astype(np.int64),
                                     is_train=True, augment=not args.no_augment,
                                     seed=42)
    ds_va = AugmentedSequenceDataset(X_va, y_va.astype(np.int64),
                                     is_train=False, augment=False,
                                     seed=42)

    class_counts = Counter(y_tr.tolist())
    sample_weights = np.array([1.0 / class_counts[l] for l in y_tr], dtype=np.float32)
    from torch.utils.data import WeightedRandomSampler
    sampler = WeightedRandomSampler(
        weights=torch.from_numpy(sample_weights),
        num_samples=len(y_tr),
        replacement=True,
    )

    dl_tr = DataLoader(ds_tr, batch_size=args.batch, sampler=sampler, num_workers=0)
    dl_va = DataLoader(ds_va, batch_size=args.batch, shuffle=False,  num_workers=0)

    # Optimizer : LR 10× plus bas que l'init, weight_decay léger
    optim = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=args.lr,
        weight_decay=1e-5,
    )
    # Pas de scheduler agressif en fine-tuning (évite d'oublier)
    loss_fn = nn.CrossEntropyLoss(weight=cw_tensor, label_smoothing=0.05)

    # ── Fine-tuning ──────────────────────────────────────────────────
    best_val = float("inf")
    best_ep  = -1
    bad_ep   = 0
    t0 = time.time()
    print("\n[FINE-TUNING]")
    for ep in range(1, args.epochs + 1):
        model.train()
        run_loss, n_seen = 0.0, 0
        for xb, yb in dl_tr:
            xb, yb = xb.to(device), yb.to(device)
            optim.zero_grad()
            logits = model(xb)
            loss = loss_fn(logits, yb)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optim.step()
            run_loss += loss.item() * xb.size(0)
            n_seen   += xb.size(0)
        train_loss = run_loss / max(1, n_seen)

        model.eval()
        val_loss, n_va = 0.0, 0
        with torch.no_grad():
            for xb, yb in dl_va:
                xb, yb = xb.to(device), yb.to(device)
                logits = model(xb)
                loss = loss_fn(logits, yb)
                val_loss += loss.item() * xb.size(0)
                n_va     += xb.size(0)
        val_loss = val_loss / max(1, n_va)

        improved = "↑" if val_loss < best_val - 1e-4 else "·"
        print(f"  epoch {ep:3d}/{args.epochs}  "
              f"train_loss={train_loss:.4f}  val_loss={val_loss:.4f}  {improved}")

        if val_loss < best_val - 1e-4:
            best_val = val_loss
            best_ep  = ep
            bad_ep   = 0
            # Sauvegarde versionnée
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            tag = args.version_tag or f"finetune_{ckpt.get('tag', 'v1')}"
            versioned_name = f"behavior_model_{tag}_{timestamp}.pt"
            versioned_path = out_path.parent / versioned_name
            save_ckpt = {
                "state_dict": model.state_dict(),
                "input_size": ckpt["input_size"],
                "hidden_size": ckpt["hidden_size"],
                "num_layers": ckpt["num_layers"],
                "num_classes": ckpt["num_classes"],
                "dropout": ckpt.get("dropout", 0.4),
                "bidirectional": ckpt.get("bidirectional", True),
                "seq_len": SEQ_LEN,
                "num_keypoints": NUM_KP,
                "kp_features": KP_FEATURES,
                "class_names": ckpt.get("class_names", {}),
                "config": vars(args),
                "best_val_loss": best_val,
                "epoch": ep,
                "tag": tag,
                "timestamp": timestamp,
                "finetuned_from": str(pretrained_path),
            }
            torch.save(save_ckpt, versioned_path)
            torch.save(save_ckpt, out_path)
        else:
            bad_ep += 1
            if bad_ep >= args.patience:
                print(f"  early stop à l'epoch {ep} (meilleur = {best_ep}, val_loss={best_val:.4f})")
                break

    elapsed = time.time() - t0
    print(f"\n  [OK] Fine-tuning termine en {elapsed/60:.1f} min")
    print(f"  [OK] Modele sauvegarde : {out_path.resolve()}")
    print(f"  [OK] Version archivee : {versioned_path.name}")
    print(f"  [OK] Meilleur val_loss : {best_val:.4f} (epoch {best_ep})")

    # ── Évaluation finale ────────────────────────────────────────────
    print("\n[EVALUATION FINALE]")
    class_names = ckpt.get("class_names", {})
    target_names = [class_names.get(int(c), f"class_{c}") for c in classes]
    y_true, y_pred = [], []
    model.eval()
    with torch.no_grad():
        for xb, yb in dl_va:
            xb, yb = xb.to(device), yb.to(device)
            logits = model(xb)
            y_pred.extend(logits.argmax(dim=1).cpu().numpy().tolist())
            y_true.extend(yb.cpu().numpy().tolist())
    print(classification_report(
        y_true, y_pred,
        labels=classes.tolist(),
        target_names=target_names,
        zero_division=0,
    ))
    acc = float(np.mean(np.array(y_true) == np.array(y_pred)))
    print(f"  Accuracy : {acc*100:.2f} %")

    # ── Mise à jour model_versions.json ───────────────────────────────
    versions_file = out_path.parent / "model_versions.json"
    versions = []
    if versions_file.exists():
        try:
            with open(versions_file, "r", encoding="utf-8") as f:
                versions = json.load(f)
        except Exception:
            versions = []
    versions.append({
        "file": versioned_path.name,
        "tag": tag,
        "timestamp": datetime.now().strftime("%Y%m%d_%H%M%S"),
        "epoch": best_ep,
        "val_loss": float(best_val),
        "accuracy": acc,
        "num_classes": ckpt["num_classes"],
        "finetuned_from": str(pretrained_path),
    })
    with open(versions_file, "w", encoding="utf-8") as f:
        json.dump(versions, f, indent=2, ensure_ascii=False)
    print(f"\n  [OK] Historique des versions : {versions_file}")

    print("\n" + "=" * 60)
    print("  [OK] FINE-TUNING TERMINE")
    print("=" * 60)
    print(f"  Le modele sera charge automatiquement par ai_engine.py")
    print(f"  au prochain redemarrage du serveur Node.")


if __name__ == "__main__":
    main()
