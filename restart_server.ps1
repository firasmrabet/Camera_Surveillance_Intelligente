$env:FORCE_COLOR = "0"
$logFile = "C:\Users\Mrabet\Desktop\PROJET_CAMERA\app_output.log"
Get-Process node -ErrorAction SilentlyContinue | Where-Object {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue
  $cmd = $proc.CommandLine
  $cmd -match "src/index.js|react-scripts"
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Set-Content -Path $logFile -Value "" -Encoding utf8
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "cd /d C:\Users\Mrabet\Desktop\projet_camera && npm start > `"$logFile`" 2>&1" -WindowStyle Hidden -PassThru
Write-Host "Started npm start, parent PID: $($proc.Id)"
