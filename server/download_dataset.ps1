$ErrorActionPreference = "SilentlyContinue"
$ProgressPreference = "SilentlyContinue"
Write-Host "[DOWNLOAD] Starting UCF-Crime from CRCV (12GB) at $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Cyan
$url = "https://www.crcv.ucf.edu/data1/chenchen/UCF_Crimes.zip"
$out = "C:\Users\Mrabet\Desktop\PROJET_CAMERA\datasets\UCF_Crimes.zip"
curl -L -o "$out" "$url" --connect-timeout 30 --max-time 7200 -C -
Write-Host "[DOWNLOAD] Finished at $(Get-Date -Format 'HH:mm:ss'), size = $((Get-Item $out -ErrorAction SilentlyContinue).Length / 1GB) GB" -ForegroundColor Green
