"""
Download UCF-Crime dataset from Hugging Face (hibana2077/UCF-Crime-Dataset).
11.8GB of pre-extracted 64x64 frames, 14 classes.
"""
import os
import sys
import time
from pathlib import Path
from huggingface_hub import snapshot_download, login

DATASETS_DIR = Path(r"C:\Users\Mrabet\Desktop\PROJET_CAMERA\datasets")
UCF_DIR = DATASETS_DIR / "UCF-Crime-Dataset"
UCF_DIR.mkdir(parents=True, exist_ok=True)

# Try authentication if HF_TOKEN is in env
hf_token = os.environ.get("HF_TOKEN")
if hf_token:
    login(token=hf_token)

REPO_ID = "hibana2077/UCF-Crime-Dataset"

print(f"=== Downloading {REPO_ID} ===")
print(f"Target: {UCF_DIR}")
print("This dataset is 11.8GB. Will take 30min-2hours depending on connection.")
print("")

start = time.time()
try:
    # Download just the metadata first to test
    path = snapshot_download(
        repo_id=REPO_ID,
        repo_type="dataset",
        local_dir=str(UCF_DIR),
        # Allow resume on interruption
        etag_timeout=30,
        max_workers=4,
    )
    elapsed = time.time() - start
    print(f"\nDownload complete in {elapsed/60:.1f} minutes")
    print(f"Path: {path}")

    # Quick inventory
    import subprocess
    res = subprocess.run(["dir", str(UCF_DIR), "/S", "/-C"], capture_output=True, text=True, shell=True)
    print(f"\n=== Directory listing (first 1000 chars) ===")
    print(res.stdout[:1000])

except KeyboardInterrupt:
    print("\nInterrupted. Can resume later with same script.")
    sys.exit(1)
except Exception as e:
    print(f"\nError: {e}")
    print("Trying with reduced concurrency...")
    try:
        path = snapshot_download(
            repo_id=REPO_ID,
            repo_type="dataset",
            local_dir=str(UCF_DIR),
            max_workers=2,
        )
        print(f"Resumed/Completed at: {path}")
    except Exception as e2:
        print(f"Final failure: {e2}")
        sys.exit(1)
