$ErrorActionPreference = "Continue"
Set-Location "C:\Users\Mrabet\Desktop\projet_camera"
& python -u ai\train_behavior_model.py --data "C:\Users\Mrabet\Desktop\projet_camera\sentinel_data" --out "C:\Users\Mrabet\Desktop\projet_camera\sentinel_data\behavior_model.pt" --epochs 50 --batch 64 --hidden 128 --layers 2 --lr 0.001 --dropout 0.4 *> "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\train_20260604_161252.out"
$LASTEXITCODE | Out-File "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\train_20260604_161252.done"
