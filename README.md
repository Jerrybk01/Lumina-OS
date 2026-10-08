# BUKA PHOTO PRO

## Project layout

- assets/core — image reconstruction, rendering engine, graph, persistence
- assets/tools — camera, selection, erase, matte, compose, intent
- assets/ui — app shell, panels, menus, styles
- assets/fonts — bundled offline fonts

The page loads these browser modules in dependency order from index.html.
The portable packer includes nested assets recursively.

Volumetric photo editor — reconstruct spatial, material, and light-field models from a single image, then edit via Thought Graph + Intent + Adjust dock.

## What it does

- Reconstruction, Adjust dock, presets/recipes, region lock, light widget
- Crop/straighten, compare modes, graph opacity, heal/retouch approximations
- Neural background removal / replacement with edge colour recovery
- Intelligent erase — remove objects and rebuild what was behind them
- Live camera: still capture and MP4/WebM video recording
- AI Talking Avatar: generate a model-animated portrait video from a photo and recorded or uploaded voice
- Export to a chosen folder, print the edited image, projects, batch, tutorial

## How to use

**Hand this to someone:** unzip the folder, double-click **start.bat** or the
Desktop **BUKA PHOTO PRO** icon, then read **USER-GUIDE.md** (or
**Tools → Help → User Guide** in the app). Quit from the tray icon near the clock.

1. Open a photo/RAW (Desktop icon, `start.bat`, or Pinokio → **BUKA PHOTO PRO**)
2. Use the Adjust panel on the right
3. **Text** adds a responsive caption box on the photo
4. **Export…** (optional resize, PNG or JPEG) or **File → Print…** for output

### Desktop icon

The first run writes one Desktop shortcut. It starts a hidden local server and
opens the browser. Right-click the **tray icon** (near the clock) → **Quit**
when you are done. A second double-click reopens the same session.

## Background removal & replacement

Open **Compose** and pick a background: **Transparent**, Color, Gradient,
Blur BG, or Image. **Transparent** is also on the chrome bar (click again to
restore) and as **Tools → Select & Mask → Transparent Background**, or the
intent `transparent background`.

The canvas shows a checker while you work. **Export…** writes a PNG with a real
alpha channel (suggested name `*-cutout.png`). The **Cutout** section controls
how the subject is isolated.

**Subject detection** chooses the matting model:

| Model | Best for | Download | License |
| --- | --- | --- | --- |
| Portrait (MODNet) | People — keeps individual hair strands | ~26 MB | Apache-2.0 |
| Any subject (BiRefNet-lite) | Products, animals, objects | ~115 MB | MIT |

Weights stream from the Hugging Face CDN the first time a model is used and are
then served from the browser cache, so later sessions start instantly. Inference
runs on WebGPU when the browser exposes an adapter and falls back to WASM
otherwise. With no network on first use, the app falls back to the built-in
heuristic matte and says so in the Cutout panel.

**Edge feather** softens the matte edge, **edge shift** grows or contracts it by
a pixel or two, and **Remove background colour spill** unmixes the original
backdrop out of semi-transparent edge pixels — this is what prevents a green or
coloured halo when a subject shot against foliage is moved onto a new
background. On a subject composited over saturated green, it cuts the average
green cast on partial pixels by roughly 87%.

Exporting with **Transparent** selected writes a PNG with a real alpha channel.

## Studio drop

**Studio** (chrome, Compose, **Tools → Select & Mask → Studio Drop**, or intent
`studio drop`) cuts the subject onto a seamless cove and plants a contact
shadow plus a faint floor reflection. Rim light and shadow direction follow
the **Light** widget — drag the sun to walk the shadow around the subject.

Compose → **Stage** has sliders for drop shadow, floor reflection, and rim.
Export writes `*-studio.png`.

## Intelligent erase & object removal

Press **E** (or **Erase** in the chrome bar) to open the erase panel, mark what
should go, and hit **Erase & fill**. The removed area is rebuilt out of the
surrounding image rather than blurred over, so horizons, tiles, railings, and
other repeating structure carry across the gap.

Four ways to mark a target, all writing into the same selection:

| Mode | Use it for |
| --- | --- |
| Brush | Anything irregular. `[` / `]` resize, Alt rubs the selection back out |
| Box | Drag a rectangle around a sign, a logo, a passer-by |
| Magic | Click an object; people/eyes use the reconstructed region, other objects grow by colour |
| Select subject (AI) | The full person or product, via the matting model |

Detected scene regions (sky, foreground, skin, …) also appear as chips in the
erase panel. Intent phrases such as **erase object**, **remove the person**, or
**erase the sky** open the panel with that region already marked.

**Edge margin** grows the selection a few pixels past what you marked, which is
what hides an object's own soft edge and its shadow fringe. **Quality** trades
time for fidelity (Fast / Balanced / Detailed).

Under the hood this is multi-scale PatchMatch texture synthesis: at each level
of an image pyramid, every patch overlapping the hole searches the intact
region for its nearest match, and the overlapping matches are averaged back
into the hole. Known pixels are never rewritten, so the fill stays pinned to
its surroundings. A typical object on a 960 px working image fills in well
under a second.

Each fill rewrites the pixels the Thought Graph evaluates from and drops an
**Erase** node as the record of it. **Undo** (⌘/Ctrl+Z) unwinds the pixels and
the node together, so erase interleaves with the rest of the history normally.

## Live camera & video recording

**File → Live Camera…** or **Live camera** on the empty state opens the camera.
Use **Record** inside that window to start a clip. **File → Record Video…**
opens the same camera and starts recording immediately.

- **Capture** pulls the current frame straight into the editor
- **Record** starts a clip — a red badge and timer show elapsed time, and press
  **R** to start/stop
- **Mic** records audio alongside the video; if the microphone is refused the
  camera keeps going without it
- **Flip** switches between cameras when more than one is present
- **+/−**, mouse wheel, or pinch zoom the live view (drag to pan when zoomed).
  **0** resets. Capture crops the zoomed frame. Optical zoom is used when the
  camera exposes it, so recorded clips follow the same zoom.

Stopping playback drops into review: the clip loops with scrub controls, so you
can **Save video…** to disk or park on a moment and pull that frame in with
**Use this frame**. Recording prefers MP4 (H.264/AAC) and falls back to WebM
where MP4 is unavailable.

The camera needs a secure context — HTTPS or localhost. Opening `index.html`
directly over `file://` will not work; use `start.bat` or the Pinokio launcher.

## AI Talking Avatar

Install **AI Talking Avatar** from this Pinokio app's menu, then choose **Start AI
Talking Avatar**. The separate local studio uses SadTalker to generate an MP4
with audio-driven mouth, expression, and head movement. Heidi's portrait is
preselected. Drag another photo into the face area to replace it. Choose
**Typed text** to have a natural neural voice speak your script, or
**Uploaded/recorded voice** to use your own recording. Text-to-speech requires an
internet connection and sends the typed script to Microsoft's Edge TTS service;
portrait animation runs locally. Choose **Generate talking video**. The generated
MP4 appears in the output player and can be downloaded from there.

The default quality profile renders at 512px, preserves the full portrait, boosts
expression movement slightly, and restores facial detail with GFPGAN. On this
GTX 1060, a 2.5-second sample took about three minutes; longer scripts take much
longer. Choose 256px for faster renders, or turn off GFPGAN if memory is tight.
The first installation downloads the optional 512px and GFPGAN checkpoints from
their official project releases.

This PC has a 6 GB GTX 1060. Use the default 256 face detail setting for the
best chance of staying within GPU memory; 512 can run out of memory. Generation
is slower on this older GPU than on current hardware. SadTalker animates a
stylized 3D face from a still portrait, so the result may differ from the
person's exact lip shape and expression.

```javascript
const form = new FormData();
form.append("face", document.querySelector("#face").files[0]);
form.append("voice", document.querySelector("#voice").files[0]);
form.append("resolution", "256");
form.append("preprocess", "crop");
form.append("pose_style", "0");
const response = await fetch("http://127.0.0.1:<port>/api/generate", { method: "POST", body: form });
const video = URL.createObjectURL(await response.blob());
```

Python and curl can use the local Gradio service as well. The service port is
chosen dynamically by Pinokio; use the URL shown in the Pinokio menu in place of
`http://127.0.0.1:7860`.

```python
import requests

with open("assets/avatar-heidi.jpg", "rb") as face, open("voice.wav", "rb") as voice:
    response = requests.post(
        "http://127.0.0.1:<port>/api/generate",
        files={"face": face, "voice": voice},
        data={"resolution": 256, "preprocess": "crop", "pose_style": 0},
        timeout=1800,
    )
    response.raise_for_status()
    open("talking-avatar.mp4", "wb").write(response.content)
```

```bash
curl -X POST "http://127.0.0.1:<port>/api/generate" `
  -F "face=@assets/avatar-heidi.jpg" `
  -F "voice=@voice.wav" `
  -F "resolution=256" -F "preprocess=crop" -F "pose_style=0" `
  --output talking-avatar.mp4
```

For text-to-speech, omit `voice` and send `speech_source=Typed text`, `text=Hello there!`, and optionally `tts_voice=en-US-AriaNeural` as form fields. The typed text is sent to Microsoft's Edge TTS service. Replace `<port>` with the port shown in the Pinokio menu. The service also
exposes `GET /api/health` for a readiness check.

## Image size

**Tools → Image → Image Size…** (or intent `resize image`) changes the working
pixel size. Width and height stay locked unless you uncheck **Constrain
proportions**. Presets include Original, 4K, 1920, 1280, 960, 800, 640, and 50%.

**Export…** opens the same size picker so you can save a smaller or larger PNG
without changing the image you are editing.

```javascript
LuminaOS.imageSize();              // open the dialog
await LuminaOS.resizeImage(1280, 720);
await LuminaOS.exportImageAs({ width: 1920, height: 1080 });
```

## Print

**File → Print…** opens a clean print dialog with only the edited image (not the dark UI chrome).

## API

```javascript
await LuminaOS.exportImageAs();
await LuminaOS.exportImageAs({ width: 1920, height: 1080, format: "jpeg" });
LuminaOS.imageSize();
await LuminaOS.resizeImage(1280, 720);
await LuminaOS.saveProjectAs();
LuminaOS.openGuide();
LuminaOS.runIntent("Make the reconstructed sky golden hour");

// Erase
LuminaOS.erase.open();
LuminaOS.erase.configure({ mode: "brush", brush: 40, grow: 4, quality: "detailed" });
await LuminaOS.erase.selectSubject();
LuminaOS.erase.selectEntity("sky");
await LuminaOS.erase.apply();
LuminaOS.undo();

// Content-aware fill directly, without the panel
const src = LuminaOS.getScene().working.imageData;
const mask = new Uint8Array(src.width * src.height); // 1 = remove this pixel
const filled = await LuminaOS.erase.fill(src, mask, { quality: "balanced" }, (p) =>
  console.log(p.label, p.pct)
);

// Camera
LuminaOS.camera.record(); // opens the camera and starts recording

// Transparent background
LuminaOS.compose.transparent();
LuminaOS.compose.isTransparent(); // true
await LuminaOS.exportImageAs(); // PNG with alpha
LuminaOS.compose.studio(); // cove + light-linked shadow
LuminaOS.compose.resetBackground();
```

Python and curl cannot drive the editor directly — it is a browser app with no
server component — but the same operations are reachable by evaluating the
JavaScript above in the page:

```python
# pip install playwright && playwright install chromium
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    page = p.chromium.launch().new_page()
    page.goto("http://127.0.0.1:5177/")
    page.evaluate("LuminaOS.erase.open()")
    page.evaluate("LuminaOS.erase.selectSubject()")
    page.evaluate("LuminaOS.erase.apply()")
```

```bash
# Same idea over the Chrome DevTools Protocol
curl -s http://127.0.0.1:9222/json | jq -r '.[0].webSocketDebuggerUrl'
# then send: {"id":1,"method":"Runtime.evaluate","params":{"expression":"LuminaOS.erase.open()"}}
```

## Honest limits

Reconstruction, heal, and retouch are client-side heuristics — not true
LIDAR/ML generative fill. Background removal is the exception: it runs a real
matting model at the working resolution (long edge up to 4096 px).

Erase is real texture synthesis, not a generative model: it can only rebuild an
area out of material that already exists elsewhere in the frame. It is very good
at skies, walls, water, foliage, pavement, and repeating pattern, and it will
struggle where the hole covers something with no counterpart nearby — a face
half behind the removed object, or text that continues under it. Regions larger
than 512 px on the long side are synthesised downscaled and resampled back up,
so very large erases come back softer than their surroundings.
