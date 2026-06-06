@echo off
REM Test live multi-class v2 - run several classes sequentially
echo ======================================================================
echo   SENTINEL - Test live v2 multi-classes
echo ======================================================================
echo.
cd /d "C:\Users\Mrabet\Desktop\projet_camera"
echo.
echo === [1/4] NORMAL ===
"C:\Program Files\Python310\python.exe" -u ai\test_live_v2.py --class "Normal" --frames 100
echo.
echo === [2/4] SHOPLIFTING ===
"C:\Program Files\Python310\python.exe" -u ai\test_live_v2.py --class "Shoplifting" --frames 100
echo.
echo === [3/4] ROBBERY ===
"C:\Program Files\Python310\python.exe" -u ai\test_live_v2.py --class "Robbery" --frames 100
echo.
echo === [4/4] SHOOTING ===
"C:\Program Files\Python310\python.exe" -u ai\test_live_v2.py --class "Shooting" --frames 100
echo.
echo ======================================================================
echo   FIN DU TEST MULTI-CLASSES
echo ======================================================================
echo DONE > "C:\Users\Mrabet\Desktop\projet_camera\ai\logs\test_multiclass.done"
