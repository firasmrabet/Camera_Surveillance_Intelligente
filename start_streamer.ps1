$env:CS_PORT = "4000"
$env:CS_SOURCE = "0"
Start-Process -FilePath "python" -ArgumentList "C:\Users\Mrabet\Desktop\PROJET_CAMERA\camera_streamer.py" -RedirectStandardOutput "C:\Users\Mrabet\Desktop\PROJET_CAMERA\streamer.log" -RedirectStandardError "C:\Users\Mrabet\Desktop\PROJET_CAMERA\streamer_err.log" -WindowStyle Hidden
