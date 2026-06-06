@echo off
cd /d "C:\Users\Mrabet\Desktop\projet_camera"
"C:\Program Files\Python310\python.exe" -u ai\train_behavior_model.py --data "C:\Users\Mrabet\Desktop\projet_camera\sentinel_data" --epochs 30 --batch 64 --hidden 128 --layers 2 --dropout 0.4 --lr 1e-3 --patience 8 > "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\train.log" 2> "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\train.err"
