$ErrorActionPreference = "Stop"
$root = "C:\Users\Mrabet\Desktop\projet_camera"
$logDir = Join-Path $root "ai\logs"
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outLog = Join-Path $logDir "ext_$stamp.out"
$errLog = Join-Path $logDir "ext_$stamp.err"
$endSig = Join-Path $logDir "ext_$stamp.done"

Remove-Item $endSig -ErrorAction SilentlyContinue

# IMPORTANT: le script sauvegarde INCRÉMENTALEMENT après chaque classe,
# donc même en cas de coupure, on garde les classes déjà traitées.
$args = @(
  "-u",
  "ai\prepare_dataset.py",
  "--dataset", "C:\Users\Mrabet\Desktop\UCF_Crimes\UCF_Crimes\Videos",
  "--max-per-class", "10",
  "--out", "C:\Users\Mrabet\Desktop\projet_camera\sentinel_data",
  "--batch-size", "8"
)

$cmdFile = Join-Path $logDir "ext_$stamp.cmd"
$cmd = @"
@echo off
cd /d "$root"
python $($args -join ' ') > "$outLog" 2> "$errLog"
echo %ERRORLEVEL% > "$endSig"
"@
Set-Content -LiteralPath $cmdFile -Value $cmd -Encoding ASCII

# Lance le .cmd détaché via cmd /c start /B
Start-Process -FilePath "cmd" -ArgumentList "/c", "start /B `"`" $cmdFile" -WindowStyle Hidden
Write-Output "Launched: $cmdFile"
Write-Output "Log:      $outLog"
Write-Output "DoneSig:  $endSig"
