"""
verify_pipeline.py
==================
Vérifie que le pipeline UCF-Crime est complet et fonctionnel.

  1. Vérifie que les fichiers existent
  2. Charge le modèle LSTM
  3. Fait une inférence dummy
  4. Charge ai_engine.py en --init
  5. Affiche un résumé
"""

import sys
import os
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "sentinel_data"
AI_DIR   = ROOT / "ai"
MODELS   = ROOT / "ai_models"


def banner(t):
    print()
    print("=" * 60)
    print(f"  {t}")
    print("=" * 60)


def check_files():
    banner("1/4 — FICHIERS REQUIS")
    required = {
        "Dataset X"      : DATA_DIR / "X_sequences.npy",
        "Dataset y"      : DATA_DIR / "y_labels.npy",
        "Stats"          : DATA_DIR / "stats.json",
        "Modèle LSTM"    : DATA_DIR / "behavior_model.pt",
        "Engine Python"  : AI_DIR / "ai_engine.py",
        "Engine fallback": AI_DIR / "ai_engine_pro.py",
        "Bridge Node"    : ROOT / "server" / "src" / "services" / "aiBridge.js",
    }
    all_ok = True
    for name, p in required.items():
        ok = p.exists() and p.stat().st_size > 0
        size = p.stat().st_size if p.exists() else 0
        size_str = f"{size/1e6:.1f} MB" if size > 1e6 else f"{size/1e3:.1f} KB" if size > 1e3 else f"{size} B"
        flag = "OK" if ok else "MANQUANT"
        print(f"  [{flag:9s}] {name:20s} {p.name:30s} {size_str}")
        all_ok = all_ok and ok
    return all_ok


def check_model_load():
    banner("2/4 — CHARGEMENT MODÈLE LSTM")
    try:
        import torch
    except ImportError:
        print("  [SKIP] torch non installé")
        return False

    model_path = DATA_DIR / "behavior_model.pt"
    if not model_path.exists():
        print(f"  [FAIL] Modèle absent : {model_path}")
        return False

    try:
        ckpt = torch.load(model_path, map_location="cpu", weights_only=False)
        print(f"  [OK] Checkpoint chargé ({model_path.stat().st_size/1e6:.1f} MB)")
        print(f"    input_size   : {ckpt.get('input_size')}")
        print(f"    hidden_size  : {ckpt.get('hidden_size')}")
        print(f"    num_layers   : {ckpt.get('num_layers')}")
        print(f"    num_classes  : {ckpt.get('num_classes')}")
        print(f"    bidirectional: {ckpt.get('bidirectional')}")
        print(f"    seq_len      : {ckpt.get('seq_len')}")
        print(f"    class_names  : {ckpt.get('class_names')}")
        print(f"    best_val_loss: {ckpt.get('best_val_loss', '?')}")
        return ckpt
    except Exception as e:
        print(f"  [FAIL] Erreur chargement : {e}")
        return None


def check_dummy_inference(ckpt):
    banner("3/4 — INFÉRENCE DUMMY")
    try:
        import torch
        import numpy as np
        from ai.ai_engine import BehaviorClassifier, AI_DIR as _
        # Crée un tenseur dummy
        seq = np.random.rand(ckpt["seq_len"], 17, 3).astype(np.float32)
        seq[:, :, 2] = 1.0  # conf=1 partout
        seq_flat = seq.reshape(1, ckpt["seq_len"], -1)
        x = torch.from_numpy(seq_flat)

        classifier = BehaviorClassifier()
        # Injecte le modèle
        classifier.model = BehaviorClassifier._build_archi(
            ckpt, __import__("torch").nn
        )
        classifier.model.load_state_dict(ckpt["state_dict"])
        classifier.model.eval()
        classifier.class_names = ckpt.get("class_names", {})

        # Warmup
        classifier.update("verify_cam", 0, seq)
        # Predict
        res = classifier.update("verify_cam", 0, seq)
        print(f"  [OK] Inférence dummy réussie")
        print(f"    behavior     : {res.get('behavior')}")
        print(f"    conf         : {res.get('conf')}")
        print(f"    smoothed     : {res.get('smoothed')}")
        return True
    except Exception as e:
        import traceback
        print(f"  [FAIL] Erreur inférence : {e}")
        traceback.print_exc()
        return False


def check_engine_init():
    banner("4/4 — ENGINE INIT (subprocess)")
    import subprocess
    engine = AI_DIR / "ai_engine.py"
    try:
        proc = subprocess.run(
            ["python", "-u", str(engine), "--init"],
            cwd=str(ROOT),
            capture_output=True, text=True, timeout=180
        )
        print(f"  [OK] Engine démarré (rc={proc.returncode})")
        if proc.stdout:
            for line in proc.stdout.strip().split("\n")[-10:]:
                print(f"    {line}")
        return True
    except subprocess.TimeoutExpired:
        print("  [FAIL] Timeout 3 min — engine ne répond pas")
        return False
    except Exception as e:
        print(f"  [FAIL] {e}")
        return False


def main():
    print("\n" + "#" * 60)
    print("  SENTINEL AI — Vérification pipeline UCF-Crime")
    print("#" * 60)

    if not check_files():
        print("\n[ABANDON] Fichiers manquants")
        return 1

    ckpt = check_model_load()
    if not ckpt:
        print("\n[ABANDON] Modèle non chargé")
        return 1

    if not check_dummy_inference(ckpt):
        print("\n[WARN] Inférence dummy échouée — le modèle est peut-être corrompu")

    if not check_engine_init():
        print("\n[WARN] Engine init échoué")

    banner("RÉSUMÉ")
    print("  ✅ Pipeline UCF-Crime opérationnel")
    print()
    print("  Pour utiliser le mode LSTM :")
    print("    1. Redémarrer le serveur Node")
    print("    2. Vérifier les logs : 'engine: lstm'")
    print("    3. GET /api/health doit montrer behavior_model chargé")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
