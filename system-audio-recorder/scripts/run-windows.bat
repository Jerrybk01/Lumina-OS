@echo off
setlocal
set "HERE=%~dp0"
if exist "%HERE%system-audio-recorder\package.json" (
  cd /d "%HERE%system-audio-recorder"
) else if exist "%HERE%..\package.json" (
  cd /d "%HERE%.."
) else if exist "%HERE%package.json" (
  cd /d "%HERE%"
) else (
  echo Cannot locate Buka Quality Sound app directory.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js/npm not found. Install Node.js 20+ from https://nodejs.org/
  pause
  exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust/cargo not found. Install from https://rustup.rs/
  pause
  exit /b 1
)
echo Installing dependencies...
call npm install
if errorlevel 1 exit /b 1
echo Starting Buka Quality Sound...
call npm run tauri:dev
