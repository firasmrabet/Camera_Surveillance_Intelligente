import zipfile
import io
import os

task_path = r"C:\Users\Mrabet\Desktop\PROJET_CAMERA\ai_models\hand_landmarker.task"
dest_dir = r"C:\Users\Mrabet\Desktop\PROJET_CAMERA\ai_models"

with open(task_path, 'rb') as f:
    f.read(2)
    data = f.read()

buf = io.BytesIO(data)
with zipfile.ZipFile(buf) as z:
    for n in z.namelist():
        out_path = os.path.join(dest_dir, n)
        with open(out_path, 'wb') as out:
            out.write(z.read(n))
        print(f"  Extracted: {n} -> {out_path} ({os.path.getsize(out_path)/1e6:.2f} MB)")
