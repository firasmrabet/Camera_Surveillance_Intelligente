#!/usr/bin/env python3
"""
Download UCF-Crime dataset parts in parallel from HuggingFace.
Uses concurrent.futures to download multiple parts simultaneously.
"""
import os
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from huggingface_hub import hf_hub_download, snapshot_download

DATASET_DIR = r"C:\Users\Mrabet\Desktop\PROJET_CAMERA\datasets"
REPO_ID = "jinmang2/ucf_crime"
# Only the parts we need (anomaly videos = 4 parts, ~12GB total)
PARTS = [
    "Anomaly-Videos-Part-1.zip",
    "Anomaly-Videos-Part-2.zip",
    "Anomaly-Videos-Part-3.zip",
    "Anomaly-Videos-Part-4.zip",
]
MAX_WORKERS = 2  # 2 parallel downloads to be polite

os.makedirs(DATASET_DIR, exist_ok=True)

progress = {p: 0 for p in PARTS}
lock = threading.Lock()

def download_part(filename):
    """Download one part with periodic progress logging."""
    target = os.path.join(DATASET_DIR, filename)
    if os.path.exists(target) and os.path.getsize(target) > 100_000_000:
        size_gb = os.path.getsize(target) / 1e9
        print(f"[SKIP] {filename} already exists ({size_gb:.2f} GB)", flush=True)
        return filename, os.path.getsize(target)

    print(f"[START] {filename}", flush=True)
    start = time.time()
    try:
        path = hf_hub_download(
            repo_id=REPO_ID,
            filename=filename,
            repo_type="dataset",
            local_dir=DATASET_DIR,
            resume_download=True,
        )
        elapsed = time.time() - start
        size_mb = os.path.getsize(path) / 1e6
        speed = size_mb / elapsed if elapsed > 0 else 0
        print(f"[DONE] {filename} in {elapsed:.0f}s ({size_mb:.0f} MB, {speed:.1f} MB/s)", flush=True)
        return filename, os.path.getsize(path)
    except Exception as e:
        print(f"[ERROR] {filename}: {e}", flush=True)
        return filename, 0

if __name__ == "__main__":
    print(f"=== UCF-Crime download started at {time.strftime('%H:%M:%S')} ===", flush=True)
    print(f"Target dir: {DATASET_DIR}", flush=True)
    print(f"Files: {len(PARTS)} parts in parallel (max {MAX_WORKERS} workers)", flush=True)
    print(flush=True)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(download_part, p): p for p in PARTS}
        for fut in as_completed(futures):
            try:
                fname, size = fut.result()
            except Exception as e:
                print(f"[FATAL] {e}", flush=True)

    print(f"\n=== Download complete at {time.strftime('%H:%M:%S')} ===", flush=True)
    total = 0
    for p in PARTS:
        f = os.path.join(DATASET_DIR, p)
        if os.path.exists(f):
            s = os.path.getsize(f)
            total += s
            print(f"  {p}: {s/1e9:.2f} GB")
    print(f"  TOTAL: {total/1e9:.2f} GB")
