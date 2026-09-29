#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [[ -d "$HERE/system-audio-recorder" ]]; then
  APP="$HERE/system-audio-recorder"
elif [[ -f "$HERE/../package.json" ]]; then
  APP="$(cd "$HERE/.." && pwd)"
elif [[ -f "$HERE/package.json" ]]; then
  APP="$HERE"
else
  echo "Cannot locate Buka Quality Sound app directory."
  exit 1
fi
cd "$APP"
if ! command -v npm >/dev/null; then
  echo "Node.js/npm not found. Install Node.js 20+ from https://nodejs.org/"
  exit 1
fi
if ! command -v cargo >/dev/null; then
  echo "Rust/cargo not found. Install from https://rustup.rs/"
  exit 1
fi
echo "Installing dependencies..."
npm install
echo "Starting Buka Quality Sound..."
echo "(Linux loopback uses Pulse/PipeWire monitor; enable Cargo feature linux-pulse for real capture.)"
npm run tauri:dev
