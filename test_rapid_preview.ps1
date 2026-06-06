$token = Get-Content "C:\Users\Mrabet\Desktop\PROJET_CAMERA\test_token.txt" -Raw
$cam = "cam-2bbe5ea7"
for ($i = 0; $i -lt 5; $i++) {
    $start = Get-Date
    $p = Invoke-WebRequest -Uri "http://localhost:5000/api/cameras/$cam/preview?token=$token&t=$i" -UseBasicParsing -TimeoutSec 10
    $elapsed = (Get-Date) - $start
    Write-Host ("Call {0}: {1} bytes, {2}ms" -f $i, $p.RawContentLength, [int]$elapsed.TotalMilliseconds)
}
