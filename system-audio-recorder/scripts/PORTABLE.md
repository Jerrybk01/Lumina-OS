# Buka Quality Sound — Portable Package

This zip is a **portable distribution** of **Buka Quality Sound** (system / loopback audio recorder).

It includes the full app source, a prebuilt web UI (`dist/`), and platform launch scripts.
On Windows you get WASAPI device/process loopback; on macOS ScreenCaptureKit system audio
(requires Screen Recording); on Linux a Pulse/PipeWire sink monitor (`libpulse-dev` required).
A full native installer binary is produced with `npm run tauri:build` on each OS.

## Quick start

### Windows
1. Install [Node.js 20+](https://nodejs.org/) and [Rust](https://rustup.rs/) (MSVC toolchain).
2. Double-click `run-windows.bat` **or** open a terminal in this folder and run it.
3. First launch runs `npm install` then `npm run tauri:dev`.

### macOS
1. Install Node.js 20+, Rust, and Xcode Command Line Tools.
2. Grant **Screen Recording** when prompted (required for system audio).
3. ```bash
   chmod +x run-macos.sh
   ./run-macos.sh
   ```

### Linux
1. Install Node.js 20+, Rust, Tauri Linux deps (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`), and `libpulse-dev`.
2. Ensure PipeWire or PulseAudio is running (sink monitor capture).
3. ```bash
   chmod +x run-linux.sh
   ./run-linux.sh
   ```

### UI-only preview (any OS with Node)
```bash
cd system-audio-recorder
npm install
npm run preview
```
Opens the polished UI with a demo audio meter (no native loopback).

## App location

```
system-audio-recorder/     ← project root (package: buka-quality-sound)
```

See `system-audio-recorder/README.md` for architecture, backends, and production builds.

## Offline-first

No accounts, cloud services, or telemetry. Recordings save only to the folder you choose.
