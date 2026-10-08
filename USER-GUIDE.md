# BUKA PHOTO PRO — User Guide

A local photo editor. Nothing is uploaded. The same walkthrough is in **guide.html** (open it from **Tools → Help → User Guide** once the app is running).

## Start

1. Unzip the folder if you received a zip. Do not open files from inside the zip.
2. Double-click **BUKA PHOTO PRO** on the Desktop, or **start.bat** in the folder.
3. The browser opens the editor. A tray icon appears near the clock.
4. To quit, right-click that tray icon and choose **Quit**.

If the browser does not open, right-click the tray icon → **Open BUKA PHOTO PRO**. A second launch reopens the same editor if it is already running.

## Open a photo

- **Open image / RAW** — JPEG, PNG, WebP, and most camera files.
- **Tools → File → Open RAW preview…** — uses the JPEG preview inside a RAW file (not a full develop).
- **Live camera** — stills and video. The address must be `http://127.0.0.1…` (this app), not a `file://` page.
- Drag a photo onto the window. Drag a `.buka.json` file to reopen a project.

Large photos open at up to **4096 px** on the long edge. Use **Image Size…** to change the working size.

## Edit

- **Adjust** panel on the right — exposure, color, contrast.
- **Left rail** — Erase, Compose, Text, Cutout, Studio, A/B, Mask, Graph, Projects, New.
- **Looks** — presets sit beside the rail. Close with **×**; reopen with the **Looks** chip or **Tools → View → Looks panel**.
- **Intent** (`Ctrl+L`) — type what you want, e.g. `golden hour sky` or `erase object`.
- **Zoom** — mouse wheel, top-bar +/−, Space+drag to pan.
- **Crop** — Crop button, then Apply.
- **Text** — responsive text box on the photo. Type, drag, resize; words wrap and type scales with the box.

## Erase objects

Press **E**. Paint, box, or magic-select what should go, then **Erase & fill**. The hole is rebuilt from nearby texture. Undo with `Ctrl+Z`.

## Background and studio

- **Transparent** — subject on a checker. Export PNG to keep the hole.
- **Compose** — color, gradient, blur, or a new background. First use may download a cutout model.
- **Studio** — cove + shadow that follows the **Light** sun.

## Live camera

Allow the camera when asked. **+/−**, wheel, or pinch to zoom. Drag to pan when zoomed. **Capture** sends a frame to the editor. **Record** (or **R**) makes a clip.

## AI talking avatar

Install **AI Talking Avatar** in Pinokio and then choose **Start AI Talking
Avatar**. The studio opens Heidi's photo by default. Drop another portrait onto
the photo area if you want to use a different face. Record your voice with the
microphone control or upload an audio recording, then choose **Generate talking
video**. The result is a model-generated MP4 with moving facial expressions and
head motion. Use 256 face detail on a 6 GB graphics card. The photo and audio
stay on this PC.

## Resize and export

- **Tools → Image → Image Size…** — change working pixels.
- **Export…** — size, then PNG or JPEG. Transparent cutouts stay PNG.
- **File → Print…** — picture only.

## Save

- **Save** (`Ctrl+S`) — a `.buka.json` project file (plus a recent copy in the browser).
- **Save Project As…** (`Ctrl+Shift+S`) — choose a new file.
- **Open Project File…** or **Recent Projects…** to continue.

**Sidecar on** means “also write a small JSON of edit settings” with PNG + sidecar. It is not camera EXIF.

## Shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+L` | Intent |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+S` / `Ctrl+Shift+S` | Save / Save As |
| `E` | Erase |
| `M` | Mask paint |
| `G` | Thought Graph |
| `C` | A/B compare |
| `Alt` (hold) | Scenescape |
| Camera `R` `+` `-` `0` `Esc` | Record, zoom, reset, close |

## Honest limits

- RAW = embedded preview, not a full develop.
- Erase copies existing texture; it cannot invent a missing face.
- Depth / reconstruction is an estimate for lighting looks.
- Menu items named “soften” are blur mixes. Use **Erase** to remove objects.

## Troubleshooting

- **Camera denied** — lock icon in the address bar → allow. URL must be `http://127.0.0.1`.
- **Blank page** — tray icon → Open, or run **start.bat** again.
- **Already running** — a second click reopens the same session. Quit from the tray to restart clean.
