# Sentinel UCF-Crime Pipeline Watchdog
# Surveille la fin de extraction puis lance training + verification
$ErrorActionPreference = "Continue"
$ROOT      = "C:\Users\Mrabet\Desktop\projet_camera"
$LOG_DIR   = Join-Path $ROOT "ai\logs"
$DATA_DIR  = Join-Path $ROOT "sentinel_data"
$PREP_LOG  = Join-Path $LOG_DIR "prepare_full.log"
$TRAIN_LOG = Join-Path $LOG_DIR "train.log"
$VERIFY_LOG = Join-Path $LOG_DIR "verify.log"

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$ts] $msg"
    Add-Content -Path (Join-Path $LOG_DIR "watchdog.log") -Value "[$ts] $msg"
}

function Wait-Process-ByName($name, $timeoutMin=240) {
    $deadline = (Get-Date).AddMinutes($timeoutMin)
    while ((Get-Date) -lt $deadline) {
        $p = Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*Python310*" -and $_.StartTime -gt (Get-Date).AddHours(-6) }
        if (-not $p) { return $true }
        Start-Sleep -Seconds 60
        $elapsed = (Get-Date) - $p[0].StartTime
        Log "  ... process running $('{0:hh\:mm}' -f $elapsed)"
    }
    return $false
}

Log "=== WATCHDOG START ==="
Log "Root: $ROOT"

# ── Étape 1 : attend fin extraction (stats.json créé) ───────────────
Log "Étape 1/3 : attente fin extraction..."
$statsPath = Join-Path $DATA_DIR "stats.json"
$deadline = (Get-Date).AddHours(6)
while ((Get-Date) -lt $deadline) {
    if ((Test-Path $statsPath) -and ((Get-Item $statsPath).LastWriteTime -gt (Get-Date).AddMinutes(-2))) {
        # Vérifie aussi que le process python d'extraction est mort
        $prepProc = Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*Python310*" }
        if (-not $prepProc) {
            $size = (Get-Item $statsPath).Length
            Log "stats.json OK ($size bytes) et process Python terminé → extraction finie"
            break
        }
    }
    Start-Sleep -Seconds 120
    $elapsed = (Get-Date) - (Get-Item $LOG_DIR -ErrorAction SilentlyContinue).LastWriteTime
    $lastLog = if (Test-Path $PREP_LOG) { (Get-Item $PREP_LOG).LastWriteTime } else { Get-Date }
    $age = (Get-Date) - $lastLog
    Log "  ... waiting (last log update: $('{0:mm}' -f $age) min ago)"
}

if (-not (Test-Path $statsPath)) {
    Log "ERREUR: stats.json jamais créé → abandon"
    exit 1
}

# ── Étape 2 : lance training LSTM ──────────────────────────────────
Log "Étape 2/3 : lancement training LSTM..."
Set-Location $ROOT
$env:PYTHONUNBUFFERED = "1"
$trainProc = Start-Process -FilePath "python" `
  -ArgumentList @("-u", "ai\train_behavior_model.py",
                  "--data", $DATA_DIR,
                  "--epochs", "60",
                  "--batch", "32",
                  "--out", (Join-Path $DATA_DIR "behavior_model.pt")) `
  -RedirectStandardOutput $TRAIN_LOG `
  -RedirectStandardError (Join-Path $LOG_DIR "train.err") `
  -WindowStyle Hidden -PassThru
Log "Training PID=$($trainProc.Id)"

# Attend fin training
$modelPath = Join-Path $DATA_DIR "behavior_model.pt"
$deadline = (Get-Date).AddHours(4)
while ((Get-Date) -lt $deadline) {
    if ((Test-Path $modelPath) -and ((Get-Item $modelPath).Length -gt 100000)) {
        $tProc = Get-Process -Id $trainProc.Id -ErrorAction SilentlyContinue
        if (-not $tProc -or $tProc.HasExited) {
            Log "behavior_model.pt créé ($(('{0:N1}' -f ((Get-Item $modelPath).Length/1MB))) MB) → training fini"
            break
        }
    }
    Start-Sleep -Seconds 60
    $lastLog = if (Test-Path $TRAIN_LOG) { (Get-Item $TRAIN_LOG).LastWriteTime } else { Get-Date }
    $age = (Get-Date) - $lastLog
    Log "  ... training in progress (last log: $('{0:mm}' -f $age) min ago)"
}

if (-not (Test-Path $modelPath)) {
    Log "ERREUR: behavior_model.pt jamais créé → abandon"
    exit 1
}

# ── Étape 3 : vérification finale ─────────────────────────────────
Log "Étape 3/3 : vérification finale..."
Set-Location $ROOT
$env:PYTHONUNBUFFERED = "1"
$verifProc = Start-Process -FilePath "python" `
  -ArgumentList @("-u", "ai\verify_pipeline.py") `
  -RedirectStandardOutput $VERIFY_LOG `
  -RedirectStandardError (Join-Path $LOG_DIR "verify.err") `
  -WindowStyle Hidden -PassThru
$verifProc.WaitForExit(60000)

if (Test-Path $VERIFY_LOG) {
    Get-Content $VERIFY_LOG
}

Log "=== WATCHDOG END ==="
