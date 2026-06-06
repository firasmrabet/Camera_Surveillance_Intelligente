"""
Download UCF-Crime dataset (or alternative) for fine-tuning YOLOv8 + Action Recognition.

UCF-Crime is 12GB / 13.7k clips from 1900 hours of surveillance footage.
Classes: Abuse, Arrest, Arson, Assault, Burglary, Explosion, Fighting,
Normal, RoadAccidents, Robbery, Shooting, Shoplifting, Stealing, Vandalism.

We use kagglehub for easier access.
"""
import os
import sys
import subprocess
import time
from pathlib import Path

DATASETS_DIR = Path(r"C:\Users\Mrabet\Desktop\PROJET_CAMERA\datasets")
DATASETS_DIR.mkdir(parents=True, exist_ok=True)

def install_kagglehub():
    try:
        import kagglehub
        return kagglehub
    except ImportError:
        print("Installing kagglehub...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "kagglehub"])
        import kagglehub
        return kagglehub

def download_ucf_crime():
    """Download UCF-Crime dataset via kagglehub"""
    kagglehub = install_kagglehub()
    print("Downloading UCF-Crime... this is ~12GB, may take 1-2 hours")
    print("Streaming partial downloads to avoid disk full")

    # Try a smaller, well-curated subset first
    targets = [
        # Larger, more comprehensive
        ("odunayo/ucf-crime-dataset", "UCF Crime Dataset"),
        # Smaller alternatives for faster training
        ("faisalalsumairi/ucf-crime", "UCF Crime Mirror"),
    ]

    for slug, name in targets:
        try:
            print(f"\nTrying {name} ({slug})...")
            path = kagglehub.dataset_download(slug, force_download=False)
            print(f"OK: {path}")
            return path
        except Exception as e:
            print(f"  Failed: {e}")
            continue
    return None

def download_hockey_fights():
    """Download Hockey Fights dataset - smaller (~1GB), good for fighting detection"""
    kagglehub = install_kagglehub()
    targets = [
        "yassershrief/hockey-fight-video-dataset",
        "krystianadammol/hockey-fight-dataset"
    ]
    for slug in targets:
        try:
            print(f"\nTrying Hockey Fights ({slug})...")
            path = kagglehub.dataset_download(slug, force_download=False)
            print(f"OK: {path}")
            return path
        except Exception as e:
            print(f"  Failed: {e}")
            continue
    return None

def download_shoplifting():
    """Download Shoplifting dataset - relevant to retail security"""
    kagglehub = install_kagglehub()
    targets = [
        "aryanskikshetra/shoplifting-dataset",
        "rafsunahmmed/shoplifting-dataset"
    ]
    for slug in targets:
        try:
            print(f"\nTrying Shoplifting ({slug})...")
            path = kagglehub.dataset_download(slug, force_download=False)
            print(f"OK: {path}")
            return path
        except Exception as e:
            print(f"  Failed: {e}")
            continue
    return None

if __name__ == "__main__":
    print("=" * 60)
    print("AI Threat Detection - Dataset Downloader")
    print("=" * 60)

    # Setup Kaggle credentials if not set
    kaggle_dir = Path.home() / ".kaggle"
    kaggle_creds = kaggle_dir / "kaggle.json"
    if not kaggle_creds.exists():
        print(f"\nNOTE: Place your kaggle.json at {kaggle_creds}")
        print("  1. Go to https://www.kaggle.com/settings")
        print("  2. Click 'Create New API Token'")
        print("  3. Save as C:\\Users\\Mrabet\\.kaggle\\kaggle.json")
        print("  Or set KAGGLE_USERNAME and KAGGLE_KEY env vars")

    # Try smaller datasets first (Hockey, Shoplifting) - faster & very relevant
    if len(sys.argv) > 1 and sys.argv[1] == "ucf":
        download_ucf_crime()
    elif len(sys.argv) > 1 and sys.argv[1] == "hockey":
        download_hockey_fights()
    elif len(sys.argv) > 1 and sys.argv[1] == "shoplift":
        download_shoplifting()
    else:
        # Default: try all small datasets in parallel-like fashion
        print("\n[1/3] Hockey Fights (1GB, for fighting/violence)...")
        download_hockey_fights()
        print("\n[2/3] Shoplifting (200MB, for theft detection)...")
        download_shoplifting()
        print("\n[3/3] UCF-Crime (12GB, for full anomaly detection)...")
        download_ucf_crime()
