@echo off
echo [DOWNLOAD] Starting UCF-Crime at %DATE% %TIME% >> C:\Users\Mrabet\Desktop\PROJET_CAMERA\server\download.log
curl -L -o "C:\Users\Mrabet\Desktop\PROJET_CAMERA\datasets\UCF_Crimes.zip" "https://www.crcv.ucf.edu/data1/chenchen/UCF_Crimes.zip" --connect-timeout 30 --max-time 7200 >> C:\Users\Mrabet\Desktop\PROJET_CAMERA\server\download.log 2>&1
echo [DOWNLOAD] Finished at %DATE% %TIME% >> C:\Users\Mrabet\Desktop\PROJET_CAMERA\server\download.log
