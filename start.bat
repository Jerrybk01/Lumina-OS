@echo off
cd /d "%~dp0"
title BUKA PHOTO PRO
echo  Starting BUKA PHOTO PRO…
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-desktop-icon.ps1" >nul 2>&1
wscript "%~dp0launch.vbs"
if errorlevel 1 (
  echo Could not start. Try right-click start.bat → Run as administrator, or open serve.ps1 in PowerShell.
  pause
)
