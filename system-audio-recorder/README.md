# Buka Quality Sound — System Audio Recorder

Professional desktop app for capturing **system / loopback audio only** (what your computer is playing — not the microphone). Built for musicians, streamers, and content creators.

Stack: **Tauri 2 + Rust** (native capture & encoding) · **Vite + TypeScript** (UI)

---

## How system-audio capture works

Microphones record air pressure at an input device. **Loopback / system capture** records the digital mix that the OS is already sending to speakers or headphones.

| Platform | Backend | What you get |
|----------|---------|--------------|
| **Windows** | **WASAPI** shared-mode loopback (`AUDCLNT_STREAMFLAGS_LOOPBACK`) on a render endpoint | Exact system output mix. Optional **per-app** process loopback on Windows 10 2004+ |
| **macOS** | **Core Audio** + **ScreenCaptureKit** audio (`capturesAudio`, mic off) | System output; optional **per-app** filter via shareable content. Requires **Screen Recording** permission |
| **Linux** | **PulseAudio / PipeWire sink monitor** (e.g. `…monitor`) | Mixed sink output (closest equivalent). **Per-app isolation is limited** — see below |

### Signal path (all platforms)

```
[OS render mix]
      │
      ▼
 Platform capture thread  ── AudioChunk (f32 PCM) ──►  process thread
                                                         ├─ resample (44.1 / 48 kHz)
                                                         ├─ optional noise gate
                                                         ├─ peak / RMS / clip detect
                                                         ├─ silence auto-split
                                                         └─ FileWriter → WAV or MP3
                                                              │
 UI thread ◄── meter + session stats (polled) ───────────────┘
```

Capture never blocks the UI. A bounded channel keeps latency low; metering and encoding run on a dedicated process thread.

### Linux limitations

- There is no WASAPI/CoreAudio-style first-class loopback API.
- We open a **sink monitor** (what is playing on that sink), not a mic source.
- Listing individual apps is best-effort; clean per-app capture usually needs manual PipeWire routing.
- Enable the optional Cargo feature `linux-pulse` and install `libpulse` development headers for real monitor capture. Without it, a silent/demo tone path is used so the UI pipeline still runs in CI.

---

## Features

- Loopback capture (WASAPI / Core Audio / Pulse monitor)
- **WAV (24-bit)** and **MP3** export at **44.1 kHz** and **48 kHz**
- Real-time waveform + L/R peak meters, timer, live file size
- Automatic **clipping** detection banner
- Per-app source selection when the OS supports it
- User-selected save folder
- Hotkeys: **R** record · **P** pause/resume · **S** stop
- Auto-split on silence threshold
- Optional lightweight noise-reduction gate
- Dark / light themes
- Clear errors for missing devices, permissions, and sample-rate mismatches

---

## Project layout

```
system-audio-recorder/          # app root (package: buka-quality-sound)
├── README.md
├── package.json
├── scripts/                    # portable build helpers
├── src/                        # UI (TypeScript)
│   ├── main.ts
│   ├── api.ts
│   └── styles.css
└── src-tauri/                  # Rust backend (crate: buka-quality-sound)
    ├── Cargo.toml
    ├── tauri.conf.json         # productName: Buka Quality Sound
    └── src/
        ├── audio/              # AudioEngine + platform backends + DSP
        ├── writer/             # FileWriter (WAV / MP3)
        └── commands.rs
```

**Modules**

| Module | Responsibility |
|--------|----------------|
| `AudioEngine` | Session lifecycle, threads, settings validation, platform dispatch |
| Platform backends | WASAPI / CoreAudio / Linux monitor capture only |
| `FileWriter` | Streaming WAV (hound) and MP3 (LAME) |
| UI | Presentation, hotkeys, folder picker, themes |

---

## Build & run

### Prerequisites

- **Node.js 20+** and npm
- **Rust** stable (1.77+)
- Platform extras:
  - **Windows**: MSVC Build Tools; no extra audio SDK
  - **macOS**: Xcode CLT; grant Screen Recording when prompted
  - **Linux**: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, and for real capture `libpulse-dev` + feature `linux-pulse`

### Install & develop

```bash
cd system-audio-recorder
npm install
npm run tauri:dev
```

Frontend-only UI demo (no native loopback — useful for layout work):

```bash
npm run dev
```

### Production / portable package

```bash
npm run tauri:build          # full native installers when toolchain allows
./scripts/make-portable.sh   # source + scripts portable zip (cross-platform)
```

### Linux with real Pulse monitor capture

```bash
cd src-tauri
cargo build --features linux-pulse
npm run tauri:dev
```

### Testing capture on Windows

1. Play music or a browser tab.
2. Launch **Buka Quality Sound**; confirm the default **render** device (speakers/headphones).
3. Choose save folder → Record. Confirm meters move **without** speaking into a mic.
4. For per-app: pick a process source (Win10 2004+). If unavailable, “All system audio” still works.
5. Export WAV @ 48 kHz and MP3 @ 44.1 kHz; verify in a DAW.

### Testing capture on macOS

1. System Settings → Privacy & Security → **Screen Recording** → enable **Buka Quality Sound**.
2. Play system audio; Record. Meters should reflect playback, not the mic.
3. Use per-app filter when SCK lists applications.
4. If permission is denied, the UI shows a clear error — re-enable and restart the app.

### Sample-rate mismatches

Shared-mode devices often run at a fixed mix rate (commonly 48 kHz). If you select 44.1 kHz, the engine **resamples** on the process thread and logs a warning. Recording still succeeds; prefer matching the device mix rate for lowest CPU.

---

## Offline-first

No accounts, no network calls, no telemetry. Files are written only to the folder you choose.

---

## License

MIT — treat this app folder as MIT for Buka Quality Sound sources.
