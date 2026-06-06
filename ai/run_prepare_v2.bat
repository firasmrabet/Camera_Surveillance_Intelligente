@echo off
cd /d "C:\Users\Mrabet\Desktop\projet_camera"
"C:\Program Files\Python310\python.exe" -u ai\prepare_dataset.py --dataset "C:\Users\Mrabet\Desktop\UCF_Crimes\UCF_Crimes\Videos" --max-per-class 20 --out "C:\Users\Mrabet\Desktop\projet_camera\sentinel_data" --imgsz 256 --frame-step 5 --batch-size 6 --min-quality 8 --merge-classes > "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\prepare_v2.log" 2> "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\prepare_v2.err"
echo DONE > "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\prepare_v2.done"
