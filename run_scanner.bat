@echo off
title SubDetect PRO — Hardcoded Subtitle Detector Engine
cls
echo =======================================================================
echo 🎬 SubDetect PRO — Hardcoded (Burned-in) Subtitle Scanner Launcher
echo =======================================================================
echo.

set "TARGET_DIR=%~1"

if "%TARGET_DIR%"=="" (
    echo Enter the full path of the folder containing your movies 
    echo (or press ENTER to scan the current directory):
    echo.
    set /p "TARGET_DIR=Folder Path: "
)

if "%TARGET_DIR%"=="" (
    set "TARGET_DIR=%~dp0"
)

echo.
echo 🚀 Launching Visual FFmpeg Hardsub Detector on: "%TARGET_DIR%"
echo.

python "%~dp0subdetect_hardsub_scanner.py" --folder "%TARGET_DIR%"

echo.
echo =======================================================================
echo Processing Finished! Press any key to exit.
echo =======================================================================
pause > nul
