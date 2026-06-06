"""
train_behavior_model.py
=======================
Étape 2 du pipeline UCF-Crime : Entraîne un classifieur LSTM sur les
séquences de keypoints produites par prepare_dataset.py.

Architecture :
  Séquence [30, 17, 3]
    → Flatten keypoints : 30 × 51 = 1530 features par frame
    → LSTM 2 couches, 128 hidden
    → Linear classifier → 9 classes
        0 Normal       4 Stealing
        1 Fighting     5 Shoplifting
        2 Assault      6 Shooting
        3 Robbery      7 Burglary
        8 Other_anomaly  (Abuse, Arrest, Arson, Explosion, RoadAccidents, Vandalism)

Choix techniques :
  - LSTM bi-directionnel (motion forward + backward)
  - Dropout 0.4 pour éviter le surapprentissage (UCF-Crime est biaisé
    vers "Normal" : 1000 vidéos vs < 200 par classe d'incident)
  - Pondération des classes via class_weight
  - AdamW + ReduceLROnPlateau + early stopping
  - Sauvegarde du meilleur modèle (val_loss)

Sortie :
  - sentinel_data/behavior_model.pt
    dictionnaire state_dict + méta (input_size, classes, seq_len, class_names)
  - Rapport de classification (sklearn)

Usage :
  python train_behavior_model.py
  python train_behavior_model.py --data ./sentinel_data --epochs 60 --batch 32
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
import torch.nn.functional as F
from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.utils.class_weight import compute_class_weight


# ── CONFIG PAR DÉFAUT ─────────────────────────────────────────────────────
DEFAULT_DATA   = "./sentinel_data"
DEFAULT_OUTPUT = "./sentinel_data/behavior_model.pt"
SEQ_LEN        = 30
NUM_KP         = 17
KP_FEATURES    = 3   # x, y, conf


# ═══════════════════════════════════════════════════════════════════════
# CHAP 12.2 — DATA AUGMENTATION POUR SÉQUENCES DE POSE
# ═══════════════════════════════════════════════════════════════════════
# Ces augmentations créent artificiellement de nouvelles variantes des
# séquences existantes. Le modèle devient robuste aux variations naturelles
# (angle de caméra, vitesse d'action, bruit de détection).
#
# Paires de keypoints gauche/droite du squelette humain (COCO 17) :
KP_LEFT_RIGHT_PAIRS = [
    (1, 2),   # yeux
    (3, 4),   # oreilles
    (5, 6),   # épaules
    (7, 8),   # coudes
    (9, 10),  # poignets
    (11, 12), # hanches
    (13, 14), # genoux
    (15, 16), # chevilles
]


def augment_sequence(seq: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """
    Augmente une séquence [T, 17, 3] avec UNE transformation aléatoire.

    Chap 12.2 : 4 types d'augmentation pondérés :
      - flip    (30%) : miroir horizontal — vue de l'autre côté de la caméra
      - noise   (30%) : bruit gaussien léger — simule l'imprécision YOLO
      - speed   (20%) : variation de vitesse — simule动作 plus rapide/lent
      - none    (20%) : aucune — laisse la séquence originale
    """
    seq = seq.copy()
    aug_type = rng.choice(["flip", "noise", "speed", "none"],
                          p=[0.30, 0.30, 0.20, 0.20])
    if aug_type == "none":
        return seq

    if aug_type == "flip":
        # Miroir horizontal : inverse X (1.0 - x) + échange les paires gauche/droite
        seq[:, :, 0] = 1.0 - seq[:, :, 0]
        for l, r in KP_LEFT_RIGHT_PAIRS:
            seq[:, [l, r], :] = seq[:, [r, l], :]

    elif aug_type == "noise":
        # Bruit gaussien léger σ=0.01 sur x,y, normalisé
        noise = rng.normal(0, 0.01, (seq.shape[0], seq.shape[1], 2)).astype(np.float32)
        seq[:, :, :2] += noise
        seq[:, :, :2] = np.clip(seq[:, :, :2], 0.0, 1.0)

    elif aug_type == "speed":
        # Étire/compresse la séquence dans le temps (facteur 0.7-1.3)
        factor = float(rng.uniform(0.7, 1.3))
        T = seq.shape[0]
        old_t = np.linspace(0, 1, T)
        new_t = np.linspace(0, 1, T) * factor
        new_t = np.clip(new_t, 0, 1)
        for kp in range(seq.shape[1]):
            for dim in range(seq.shape[2]):
                seq[:, kp, dim] = np.interp(new_t, old_t, seq[:, kp, dim])

    return seq


class AugmentedSequenceDataset(torch.utils.data.Dataset):
    """
    Dataset qui applique la data augmentation UNIQUEMENT sur le set
    d'entraînement (jamais sur val/test). Cf. Chap 12.2.
    """
    def __init__(self, X: np.ndarray, y: np.ndarray, is_train: bool = True,
                 augment: bool = True, seed: int = 42):
        self.X = torch.from_numpy(np.ascontiguousarray(X, dtype=np.float32))
        self.y = torch.from_numpy(np.ascontiguousarray(y, dtype=np.int64))
        self.is_train = is_train
        self.augment = augment and is_train
        self.rng = np.random.default_rng(seed)

    def __len__(self):
        return len(self.X)

    def __getitem__(self, i):
        x = self.X[i].numpy()  # [T, NUM_KP * KP_FEATURES] = [30, 51]
        if self.augment:
            # augment_sequence attend [T, 17, 3] : on reshape, on aug, on re-flatten
            x3d = x.reshape(SEQ_LEN, NUM_KP, KP_FEATURES)
            x3d = augment_sequence(x3d, self.rng)
            x = x3d.reshape(SEQ_LEN, NUM_KP * KP_FEATURES)
        return torch.from_numpy(np.ascontiguousarray(x, dtype=np.float32)), self.y[i]


class BehaviorLSTM(nn.Module):
    """
    Réseau LSTM pour classification comportementale.

    Entrée : (batch, seq_len, num_keypoints * kp_features)
      30 × 17 × 3 = 1530 features par frame.

    Sortie : logits (batch, num_classes).
    """

    def __init__(self, input_size: int, hidden_size: int = 128,
                 num_layers: int = 2, num_classes: int = 7,
                 dropout: float = 0.4, bidirectional: bool = True):
        super().__init__()
        self.bidirectional = bidirectional
        self.hidden_size   = hidden_size
        self.num_layers    = num_layers

        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
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

    def forward(self, x):
        # x: [B, T, F]
        out, _ = self.lstm(x)
        # moyenne temporelle + max temporel (max-pooling) → robuste
        avg = out.mean(dim=1)
        mx, _ = out.max(dim=1)
        feat = (avg + mx) / 2.0
        return self.head(feat)


def parse_args():
    p = argparse.ArgumentParser(description="Train Behavior LSTM (UCF-Crime)")
    p.add_argument("--data",    default=DEFAULT_DATA)
    p.add_argument("--out",     default=DEFAULT_OUTPUT)
    p.add_argument("--epochs",  type=int, default=60)
    p.add_argument("--batch",   type=int, default=32)
    p.add_argument("--lr",      type=float, default=1e-3)
    p.add_argument("--hidden",  type=int, default=128)
    p.add_argument("--layers",  type=int, default=2)
    p.add_argument("--dropout", type=float, default=0.4)
    p.add_argument("--seed",    type=int, default=42)
    p.add_argument("--patience", type=int, default=10, help="early stopping")
    p.add_argument("--no-bidir", action="store_true", help="désactive le BiLSTM")
    p.add_argument("--cpu",     action="store_true", help="force CPU")
    p.add_argument("--no-augment", action="store_true",
                   help="Chap 12.2 : désactive la data augmentation")
    p.add_argument("--version-tag", default="",
                   help="Chap 13.3 : tag de version (ex: v2_quality_filter). "
                        "Le modèle sera sauvegardé avec ce nom ET un symlink .pt")
    return p.parse_args()


def load_data(data_path: Path):
    X_path = data_path / "X_sequences.npy"
    y_path = data_path / "y_labels.npy"
    if not X_path.exists() or not y_path.exists():
        sys.exit(f"[ERREUR] Fichiers manquants dans {data_path}.\n"
                 f"Exécute d'abord : python prepare_dataset.py")

    X = np.load(X_path, mmap_mode="r")
    y = np.load(y_path)

    # Reshape : [N, T, KP, F] -> [N, T, KP*F]
    # support mémoire : on reste en float32 et on charge en mémoire
    X = np.array(X, dtype=np.float32)
    N, T, K, F_ = X.shape
    assert T == SEQ_LEN, f"SEQ_LEN mismatch : dataset={T} attendu={SEQ_LEN}"
    assert K == NUM_KP, f"Nombre de keypoints mismatch : dataset={K} attendu={NUM_KP}"
    X = X.reshape(N, T, K * F_)
    return X, y


def build_loaders(X, y, args, device):
    X_tr, X_va, y_tr, y_va = train_test_split(
        X, y, test_size=0.20, random_state=args.seed, stratify=y
    )

    # class weights (sklearn balanced) — Chap 11.2
    classes = np.unique(y)
    cw = compute_class_weight("balanced", classes=classes, y=y_tr)
    cw_tensor = torch.tensor(cw, dtype=torch.float32, device=device)

    # Sampler pondéré pour le train (évite que la classe Normal domine)
    class_counts = Counter(y_tr.tolist())
    sample_weights = np.array([1.0 / class_counts[l] for l in y_tr], dtype=np.float32)
    sampler = WeightedRandomSampler(
        weights=torch.from_numpy(sample_weights),
        num_samples=len(y_tr),
        replacement=True,
    )

    # Datasets avec data augmentation UNIQUEMENT sur le train (Chap 12.2)
    ds_tr = AugmentedSequenceDataset(X_tr, y_tr.astype(np.int64),
                                     is_train=True, augment=not args.no_augment,
                                     seed=args.seed)
    ds_va = AugmentedSequenceDataset(X_va, y_va.astype(np.int64),
                                     is_train=False, augment=False,
                                     seed=args.seed)

    dl_tr = DataLoader(ds_tr, batch_size=args.batch, sampler=sampler, num_workers=0)
    dl_va = DataLoader(ds_va, batch_size=args.batch, shuffle=False,  num_workers=0)
    return dl_tr, dl_va, cw_tensor, classes


def evaluate(model, loader, device, classes, class_names):
    model.eval()
    y_true, y_pred = [], []
    with torch.no_grad():
        for xb, yb in loader:
            xb, yb = xb.to(device), yb.to(device)
            logits = model(xb)
            y_pred.extend(logits.argmax(dim=1).cpu().numpy().tolist())
            y_true.extend(yb.cpu().numpy().tolist())

    target_names = [class_names.get(int(c), f"class_{c}") for c in classes]
    print("\n[VALIDATION — RAPPORT]")
    print(classification_report(
        y_true, y_pred,
        labels=classes.tolist(),
        target_names=target_names,
        zero_division=0,
    ))
    return float(np.mean(np.array(y_true) == np.array(y_pred)))


def main():
    args = parse_args()
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    data_path = Path(args.data)
    out_path  = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    device = torch.device(
        "cuda" if torch.cuda.is_available() and not args.cpu else "cpu"
    )
    print("=" * 60)
    print("  SENTINEL AI — Entraînement LSTM comportemental")
    print("=" * 60)
    print(f"  Device   : {device}")
    print(f"  Data     : {data_path.resolve()}")
    print(f"  Output   : {out_path.resolve()}")

    # ── Charger dataset ────────────────────────────────────────────────
    X, y = load_data(data_path)
    print(f"  X.shape  : {X.shape}")
    print(f"  y.shape  : {y.shape}")
    print(f"  classes  : {np.unique(y, return_counts=True)}")

    class_names = {}
    # Ordre canonique (le premier qui matche gagne) — pour le mode 9 classes
    CANONICAL_NAMES = {
        0: "Normal", 1: "Fighting", 2: "Assault", 3: "Robbery",
        4: "Stealing", 5: "Shoplifting", 6: "Shooting",
        7: "Burglary", 8: "Other_anomaly",
    }
    # Ordre canonique pour le mode 6 classes fusionnees
    CANONICAL_NAMES_MERGED = {
        0: "Normal", 1: "Violence", 2: "Theft", 3: "Weapon",
        4: "Intrusion", 5: "Other",
    }
    stats_path = data_path / "stats.json"
    if stats_path.exists():
        with open(stats_path, "r", encoding="utf-8") as f:
            stats = json.load(f)
        # Lit les classes depuis stats.json : { "Fighting": 1, "Assault": 1, ... }
        for k, v in stats.get("classes", {}).items():
            iv = int(v)
            if iv not in class_names:
                class_names[iv] = k
    # Détecte le nombre réel de classes dans le dataset
    num_unique = len(np.unique(y))
    if num_unique == 6 and not any("merged" in str(stats.get("config", {})).lower() for _ in [0]):
        # Mode 6 classes : utilise CANONICAL_NAMES_MERGED
        for k, v in CANONICAL_NAMES_MERGED.items():
            class_names[k] = v
    else:
        # Mode 9 classes (ou autre) : utilise CANONICAL_NAMES standard
        for k, v in CANONICAL_NAMES.items():
            class_names[k] = v
    # Filtre pour ne garder que les classes réellement présentes
    class_names = {k: v for k, v in class_names.items() if k in np.unique(y)}

    # ── Loaders ───────────────────────────────────────────────────────
    dl_tr, dl_va, cw, classes = build_loaders(X, y, args, device)
    input_size  = X.shape[-1]
    num_classes = len(classes)
    print(f"  input    : {input_size}  classes : {num_classes}")

    # ── Modèle ────────────────────────────────────────────────────────
    model = BehaviorLSTM(
        input_size=input_size,
        hidden_size=args.hidden,
        num_layers=args.layers,
        num_classes=num_classes,
        dropout=args.dropout,
        bidirectional=not args.no_bidir,
    ).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"  modèle   : {n_params:,} paramètres  (BiLSTM={not args.no_bidir})")

    optim = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(optim, mode="min", factor=0.5, patience=4)
    loss_fn = nn.CrossEntropyLoss(weight=cw, label_smoothing=0.05)

    # ── Entraînement ──────────────────────────────────────────────────
    best_val = float("inf")
    best_ep  = -1
    bad_ep   = 0
    t0 = time.time()
    print("\n[ENTRAÎNEMENT]")
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

        # Validation
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
        sched.step(val_loss)

        lr_now = optim.param_groups[0]["lr"]
        print(f"  epoch {ep:3d}/{args.epochs}  "
              f"train_loss={train_loss:.4f}  val_loss={val_loss:.4f}  lr={lr_now:.2e}")

        if val_loss < best_val - 1e-4:
            best_val = val_loss
            best_ep  = ep
            bad_ep   = 0
            # Chap 13.3 — versionning : on garde une copie horodatée + la symlink
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            tag = args.version_tag or "v1"
            versioned_name = f"behavior_model_{tag}_{timestamp}.pt"
            versioned_path = out_path.parent / versioned_name
            torch.save({
                "state_dict": model.state_dict(),
                "input_size": input_size,
                "hidden_size": args.hidden,
                "num_layers": args.layers,
                "num_classes": num_classes,
                "dropout": args.dropout,
                "bidirectional": not args.no_bidir,
                "seq_len": SEQ_LEN,
                "num_keypoints": NUM_KP,
                "kp_features": KP_FEATURES,
                "class_names": {int(k): v for k, v in class_names.items()},
                "config": vars(args),
                "best_val_loss": best_val,
                "epoch": ep,
                "tag": tag,
                "timestamp": timestamp,
            }, versioned_path)
            # Symlink/copie vers le fichier canonique
            torch.save({
                "state_dict": model.state_dict(),
                "input_size": input_size,
                "hidden_size": args.hidden,
                "num_layers": args.layers,
                "num_classes": num_classes,
                "dropout": args.dropout,
                "bidirectional": not args.no_bidir,
                "seq_len": SEQ_LEN,
                "num_keypoints": NUM_KP,
                "kp_features": KP_FEATURES,
                "class_names": {int(k): v for k, v in class_names.items()},
                "config": vars(args),
                "best_val_loss": best_val,
                "epoch": ep,
                "tag": tag,
                "timestamp": timestamp,
            }, out_path)
            # Tient à jour un fichier de versions
            versions_file = out_path.parent / "model_versions.json"
            versions = []
            if versions_file.exists():
                try:
                    with open(versions_file, "r", encoding="utf-8") as f:
                        versions = json.load(f)
                except Exception:
                    versions = []
            versions.append({
                "file": versioned_name,
                "tag": tag,
                "timestamp": timestamp,
                "epoch": ep,
                "val_loss": float(best_val),
                "num_classes": num_classes,
                "config": vars(args),
            })
            with open(versions_file, "w", encoding="utf-8") as f:
                json.dump(versions, f, indent=2, ensure_ascii=False)
        else:
            bad_ep += 1
            if bad_ep >= args.patience:
                print(f"  early stop à l'epoch {ep} (meilleur = {best_ep}, val_loss={best_val:.4f})")
                break

    elapsed = time.time() - t0
    # Écriture ASCII uniquement (évite UnicodeEncodeError sur Windows cp1252)
    print(f"\n  [OK] Entrainement termine en {elapsed/60:.1f} min")
    print(f"  [OK] Modele sauvegarde : {out_path.resolve()}")
    print(f"  [OK] Meilleur val_loss : {best_val:.4f} (epoch {best_ep})")
    print(f"  [OK] Version archivee : {versioned_path.name}")

    # ── Évaluation finale sur le meilleur modèle ─────────────────────
    print("\n[EVALUATION FINALE]")
    ckpt = torch.load(out_path, map_location=device, weights_only=False)
    model.load_state_dict(ckpt["state_dict"])
    acc = evaluate(model, dl_va, device, classes, class_names)
    print(f"  Accuracy validation : {acc * 100:.2f} %")

    print("\n" + "=" * 60)
    print("  [OK] LSTM ENTRAINE")
    print("=" * 60)
    print(f"  Fichier : {out_path.resolve()}")
    print(f"  Version : {versioned_path.name}")
    print(f"  Prochaine etape : redemarrer le serveur Node, l'engine")
    print(f"  Python sera auto-selectionne par aiBridge.js.")


if __name__ == "__main__":
    main()
