#!/usr/bin/env bash
# Build a portable zip of Buka Quality Sound (source + run scripts + prebuilt UI).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
NAME="Buka-Quality-Sound-portable"
DEST_DIR="${1:-$ROOT/dist-portable}"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

mkdir -p "$STAGE/$NAME/system-audio-recorder" "$DEST_DIR"

# Copy app sources (exclude heavy/build caches) via tar filter
tar -C "$ROOT" \
  --exclude=node_modules \
  --exclude=src-tauri/target \
  --exclude=dist \
  --exclude=dist-portable \
  --exclude=.git \
  --exclude='*.log' \
  -cf - . | tar -C "$STAGE/$NAME/system-audio-recorder" -xf -

# Ensure frontend dist is included
if [[ ! -d "$ROOT/dist" ]]; then
  (cd "$ROOT" && npm install --silent && npm run build --silent) || true
fi
if [[ -d "$ROOT/dist" ]]; then
  mkdir -p "$STAGE/$NAME/system-audio-recorder/dist"
  tar -C "$ROOT/dist" -cf - . | tar -C "$STAGE/$NAME/system-audio-recorder/dist" -xf -
fi

# Top-level portable docs + launchers
cp "$ROOT/scripts/PORTABLE.md" "$STAGE/$NAME/README.md"
cp "$ROOT/scripts/run-windows.bat" "$STAGE/$NAME/"
cp "$ROOT/scripts/run-macos.sh" "$STAGE/$NAME/"
cp "$ROOT/scripts/run-linux.sh" "$STAGE/$NAME/"
chmod +x "$STAGE/$NAME/run-macos.sh" "$STAGE/$NAME/run-linux.sh"
chmod +x "$STAGE/$NAME/system-audio-recorder/scripts/"*.sh 2>/dev/null || true

ZIP_PATH="$DEST_DIR/${NAME}.zip"
rm -f "$ZIP_PATH"
(cd "$STAGE" && zip -rq "$ZIP_PATH" "$NAME")

echo "Created: $ZIP_PATH"
ls -la "$ZIP_PATH"
