@echo off
cd /d "C:\Users\Mrabet\Desktop\projet_camera"
"C:\Program Files\Python310\python.exe" -u ai\train_behavior_model.py --data "C:\Users\Mrabet\Desktop\projet_camera\sentinel_data" --out "C:\Users\Mrabet\Desktop\projet_camera\sentinel_data\behavior_model.pt" --epochs 50 --batch 32 --hidden 128 --layers 2 --dropout 0.4 --lr 0.001 --patience 8 --version-tag v2_quality_merged > "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\train_v2.log" 2> "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\train_v2.err"
echo DONE > "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\train_v2.done"
