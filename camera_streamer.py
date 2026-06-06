"""
Universal Camera Streamer — Python + OpenCV
Reads from ANY source (USB webcam, IP camera URL, RTSP, etc.)
Serves local MJPEG stream on /videofeed and snapshots on /shot.jpg
Usage:
  python camera_streamer.py --source 0 --port 5100 --width 640 --height 480 --quality 80
  python camera_streamer.py --source "http://user:pass@192.168.1.x:8080/videofeed" --port 5101
"""
import sys, os, socket, struct, signal, time, threading, io
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import cv2
import numpy as np

# ============ CONFIG ============
SOURCE = os.environ.get("CS_SOURCE", "0")
PORT   = int(os.environ.get("CS_PORT", "5100"))
WIDTH  = int(os.environ.get("CS_WIDTH", "854"))
HEIGHT = int(os.environ.get("CS_HEIGHT", "480"))
QUALITY= int(os.environ.get("CS_QUALITY", "65"))
FPS    = int(os.environ.get("CS_FPS", "30"))
# ================================

import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--source", default=SOURCE)
parser.add_argument("--port", type=int, default=PORT)
parser.add_argument("--width", type=int, default=WIDTH)
parser.add_argument("--height", type=int, default=HEIGHT)
parser.add_argument("--quality", type=int, default=QUALITY)
parser.add_argument("--fps", type=int, default=FPS)
args = parser.parse_args()

SOURCE = args.source
PORT   = args.port
WIDTH  = args.width
HEIGHT = args.height
QUALITY= min(100, max(10, args.quality))
FPS    = min(60, max(1, args.fps))

running = True
frame_lock = threading.Lock()
latest_frame = None
frame_count = 0

def signal_handler(sig, frame):
    global running
    running = False
    sys.exit(0)

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

def capture_loop():
    global latest_frame, frame_count, running

    # Convert SOURCE to int if it's a digit (webcam index)
    try:
        src = int(SOURCE)
    except ValueError:
        src = SOURCE

    cap = cv2.VideoCapture(src)
    # Tenter de réduire le buffer interne d'OpenCV pour une latence ZERO
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    if not cap.isOpened():
        print(f"[ERROR] Cannot open source: {SOURCE}", flush=True)
        running = False
        return

    # Try to set resolution
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)

    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    actual_fps = cap.get(cv2.CAP_PROP_FPS) or FPS
    print(f"[OK] Source={SOURCE} -> {actual_w}x{actual_h} @ {actual_fps:.1f}fps", flush=True)

    frame_time = 1.0 / FPS
    
    # === SOLUTION PROFESSIONNELLE : THREAD DE CAPTURE ===
    # OpenCV met les images en file d'attente (buffer). Si on lit et on encode 
    # dans la même boucle, la file se remplit et crée le fameux "retard".
    # Solution : Un thread vide le buffer aussi vite que possible.
    raw_frame = None
    new_frame_event = threading.Event()

    def _reader():
        nonlocal raw_frame
        while running:
            ok, f = cap.read()
            if ok:
                raw_frame = f
                new_frame_event.set()
            else:
                time.sleep(0.01)

    reader_thread = threading.Thread(target=_reader, daemon=True)
    reader_thread.start()

    last_ts = time.time()

    while running:
        # Attendre une nouvelle image (timeout = 1 sec max)
        if not new_frame_event.wait(1.0):
            continue
        new_frame_event.clear()

        frame = raw_frame
        if frame is None:
            continue

        # Resize if needed
        if frame.shape[1] != WIDTH or frame.shape[0] != HEIGHT:
            frame = cv2.resize(frame, (WIDTH, HEIGHT), interpolation=cv2.INTER_LINEAR)

        # Encode JPEG
        ok2, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, QUALITY])
        if not ok2:
            continue

        with frame_lock:
            latest_frame = buf.tobytes()
            frame_count += 1

        # Throttle to target FPS pour éviter de saturer le réseau
        elapsed = time.time() - last_ts
        sleep_time = frame_time - elapsed
        if sleep_time > 0:
            time.sleep(sleep_time)
        last_ts = time.time()

    cap.release()

class StreamHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress HTTP logs

    def do_GET(self):
        global latest_frame, frame_count

        if self.path == "/videofeed" or self.path == "/video":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=--jpgboundary")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store, no-cache")
            self.end_headers()
            last_count = -1
            try:
                while running:
                    with frame_lock:
                        if latest_frame is not None and frame_count != last_count:
                            data = latest_frame
                            last_count = frame_count
                        else:
                            data = None
                    if data:
                        self.wfile.write(b"--jpgboundary\r\n")
                        self.wfile.write(b"Content-Type: image/jpeg\r\n")
                        self.wfile.write(f"Content-Length: {len(data)}\r\n\r\n".encode())
                        self.wfile.write(data)
                        self.wfile.write(b"\r\n")
                    else:
                        time.sleep(0.005)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            return

        if self.path == "/shot.jpg":
            with frame_lock:
                data = latest_frame
            if data:
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_response(503)
                self.end_headers()
            return

        if self.path == "/stats":
            with frame_lock:
                fc = frame_count
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({
                "source": SOURCE,
                "width": WIDTH,
                "height": HEIGHT,
                "quality": QUALITY,
                "fps_target": FPS,
                "frame_count": fc,
                "running": running
            }).encode())
            return

        # HTML page
        html = f"""<!DOCTYPE html>
<html><head><title>Camera Stream</title>
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ background:#1a1a2e; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; font-family:Arial,sans-serif; }}
h2 {{ color:#00d4ff; margin-bottom:15px; font-size:20px; letter-spacing:2px; }}
.box {{ border:2px solid #00d4ff; border-radius:12px; overflow:hidden; box-shadow:0 0 30px rgba(0,212,255,0.3); }}
img {{ display:block; width:{WIDTH}px; height:{HEIGHT}px; }}
.info {{ color:#888; margin-top:12px; font-size:13px; }}
a {{ color:#00d4ff; text-decoration:none; }}
</style></head><body>
<h2>&#128247; CAMERA STREAM</h2>
<div class='box'><img src='/video'></div>
<p class='info'>Source: {SOURCE} | {WIDTH}x{HEIGHT} @ {FPS}fps | Quality: {QUALITY}%<br>
<a href='/shot.jpg'>&#128248; Snapshot</a> &middot; <a href='/video'>Video</a> &middot; <a href='/stats'>Stats</a></p>
</body></html>
"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))
        return

import json
httpd = HTTPServer(("0.0.0.0", PORT), StreamHandler)

capture_thread = threading.Thread(target=capture_loop, daemon=True)
capture_thread.start()

print(f"\n{'='*50}", flush=True)
print(f"   CAMERA STREAMER ACTIVE", flush=True)
print(f"{'='*50}", flush=True)
print(f"   Source  : {SOURCE}", flush=True)
print(f"   Stream  : http://localhost:{PORT}/videofeed", flush=True)
print(f"   Snapshot: http://localhost:{PORT}/shot.jpg", flush=True)
print(f"   Page    : http://localhost:{PORT}/", flush=True)
print(f"   {WIDTH}x{HEIGHT} @ {FPS}fps | Quality: {QUALITY}%", flush=True)
print(f"{'='*50}", flush=True)

try:
    httpd.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    running = False
    httpd.shutdown()
    print("\n[OK] Streamer stopped", flush=True)
