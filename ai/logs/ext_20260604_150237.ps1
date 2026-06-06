$ErrorActionPreference = "Continue"
Set-Location "C:\Users\Mrabet\Desktop\projet_camera"
& python -u ai\prepare_dataset.py --dataset "C:\Users\Mrabet\Desktop\UCF_Crimes\UCF_Crimes\Videos" --max-per-class 10 --out "C:\Users\Mrabet\Desktop\projet_camera\sentinel_data" --batch-size 8 *> "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\ext_20260604_150237.out"
$LASTEXITCODE | Out-File "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\ext_20260604_150237.done"
