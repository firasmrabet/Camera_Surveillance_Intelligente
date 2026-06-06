@echo off
cd /d "C:\Users\Mrabet\Desktop\projet_camera"
python -u ai\prepare_dataset.py --dataset C:\Users\Mrabet\Desktop\UCF_Crimes\UCF_Crimes\Videos --max-per-class 10 --out C:\Users\Mrabet\Desktop\projet_camera\sentinel_data --batch-size 8 > "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\ext_20260604_150009.out" 2> "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\ext_20260604_150009.err"
echo %ERRORLEVEL% > "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\ext_20260604_150009.done"
