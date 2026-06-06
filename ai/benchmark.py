import time
import cv2
from ultralytics import YOLO

img = cv2.imread(r'C:\Users\Mrabet\Desktop\PROJET_CAMERA\ai_models\test_bus.jpg')
print(f"Image: {img.shape}")

for size in ['n', 'm']:
    print(f"\n=== YOLOv8{size} ===")
    m = YOLO(fr'C:\Users\Mrabet\Desktop\PROJET_CAMERA\ai_models\yolov8{size}.pt')
    # warmup
    m.predict(img, imgsz=640, conf=0.4, verbose=False)
    # measure
    times = []
    for _ in range(3):
        t0 = time.time()
        r = m.predict(img, imgsz=640, conf=0.4, verbose=False)[0]
        t1 = time.time()
        times.append((t1-t0)*1000)
    avg = sum(times) / len(times)
    print(f"  {len(r.boxes)} detections, avg={avg:.0f}ms (runs: {[int(t) for t in times]})")
