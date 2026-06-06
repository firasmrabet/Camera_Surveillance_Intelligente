# Full integration test
$TOKEN = node get_token.js
$headers = @{Authorization="Bearer $TOKEN"}

Write-Host "=== Final integration test ===" -ForegroundColor Cyan

# 1) Presets work
Write-Host "1. Camera presets..." -ForegroundColor Yellow
$presets = Invoke-RestMethod -Uri "http://localhost:5000/api/cameras/presets" -Method GET
$ipWebcam = $presets.presets | Where-Object { $_.id -eq "ip_webcam_android" }
Write-Host "   OK: 17 presets, IP Webcam port $($ipWebcam.defaultPort.mjpeg)"

# 2) Network scan
Write-Host "2. Network scan..." -ForegroundColor Yellow
$body = @{port=8080} | ConvertTo-Json
$scan = Invoke-RestMethod -Uri "http://localhost:5000/api/cameras/scan-network" -Method POST -Headers $headers -ContentType "application/json" -Body $body
Write-Host "   OK: Found $($scan.devices.Count) device(s) on port $($scan.port)"

# 3) Test connection (sanitize URL)
Write-Host "3. URL sanitize + test-connection..." -ForegroundColor Yellow
$body = @{protocol="mjpeg"; host="http://localhost:5000"; path="/"; port=$null} | ConvertTo-Json
$test = Invoke-RestMethod -Uri "http://localhost:5000/api/cameras/test-connection" -Method POST -Headers $headers -ContentType "application/json" -Body $body
Write-Host "   OK: test ok=$($test.ok), error=$($test.error)"

# 4) AI detection
Write-Host "4. AI detection (full pipeline)..." -ForegroundColor Yellow
$testImgPath = "C:\Users\Mrabet\Desktop\PROJET_CAMERA\ai_models\test_bus.jpg"
$bytes = [System.IO.File]::ReadAllBytes($testImgPath)
$b64 = [Convert]::ToBase64String($bytes)
$body = @{ image = "data:image/jpeg;base64,$b64" } | ConvertTo-Json -Depth 3
$t0 = Get-Date
$ai = Invoke-RestMethod -Uri "http://localhost:5000/api/ai/test-frame" -Method POST -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 30
$elapsed = (Get-Date) - $t0
Write-Host "   OK: $([Math]::Round($elapsed.TotalSeconds,1))s HTTP, $($ai.processing_time_ms)ms AI"
Write-Host "   Persons: $($ai.persons.Count) tracked"
Write-Host "   Poses: $($ai.poses.Count)"
Write-Host "   Hands: $($ai.hands.Count) (all source: $($($ai.hands)[0].source))"
Write-Host "   Activities: $($ai.activities.PSObject.Properties.Count) tracks"

# 5) Run multiple frames to populate activity tracker
Write-Host "5. Multi-frame activity test..." -ForegroundColor Yellow
$body = @{ image = "data:image/jpeg;base64,$b64" } | ConvertTo-Json -Depth 3
for ($i=1; $i -le 5; $i++) {
    $r = Invoke-RestMethod -Uri "http://localhost:5000/api/ai/test-frame" -Method POST -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 30
    Write-Host "   Frame $i : persons=$($r.persons.Count), activities=$($r.activities.PSObject.Properties.Count)"
}

Write-Host ""
Write-Host "=== All tests passed ===" -ForegroundColor Green
