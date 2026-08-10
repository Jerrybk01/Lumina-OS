# Lumina OS

Volumetric photo editor — reconstruct spatial, material, and light-field models from a single image, then edit via Thought Graph + Intent (not layers).

**Separate from Buka Photo Studio.**

## What it does (v0.2)

- **Reconstruction** — multi-cue depth, material map, light-field estimate, camera profiles
- **RAW ingest** — extracts embedded JPEG preview from NEF/CR2/ARW/RAF/DNG/etc.
- **Semantic entities** — sky / mountains / foreground + portrait (skin/eyes via FaceDetector or skin fallback)
- **Zone A** — Photobase; hold **Alt** for Scenescape (parallax, orbit, normals, sun vector)
- **Zone B** — Adaptive Material HUD (atmospheric + portrait catchlight/SSS)
- **Zone C** — Live Thought Graph DAG (edit early nodes → downstream recomputes)
- **Functional Blend** — mask by material (sky/mountains/FG) or painted mask
- **Zone D** — Text + **voice** intent; `select sky` type-to-focus
- **A/B compare**, **mask paint**, **undo**, **local projects**, **PNG + JSON sidecar export**

## How to use

1. Pinokio → **Lumina OS** → Open
2. **Load demo landscape** or drop a photo/RAW
3. Intent: `Reconstruct sky detail from scattering`
4. Hover sky → micro-dials; or type `select sky`
5. Intent: `Make the reconstructed sky golden hour`
6. Graph → select two branches → **Blend** (Sky←Sunset · FG←Day)
7. **Export** → PNG + graph sidecar JSON

## Keyboard

| Shortcut | Action |
|----------|--------|
| `⌘/Ctrl + L` | Focus Intent |
| `Alt` hold | Scenescape |
| `G` | Thought Graph |
| `C` | A/B compare |
| `M` | Mask paint |
| `⌘/Ctrl + Z` | Undo graph |
| `⌘/Ctrl + S` | Save project |

## API (`window.LuminaOS`)

### JavaScript

```javascript
await LuminaOS.openDemo();
LuminaOS.runIntent("Reconstruct sky detail from scattering");
LuminaOS.runIntent("Make the reconstructed sky golden hour");
LuminaOS.runIntent("select sky");
console.log(LuminaOS.getGraph(), LuminaOS.getEntities(), LuminaOS.getParams());
LuminaOS.setParams({ goldenHour: 0.6, sunAngle: 48 });
LuminaOS.saveProject();
LuminaOS.exportPng();
```

### Python (Playwright)

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://127.0.0.1:5177/")  # or Pinokio app URL
    page.evaluate("() => LuminaOS.openDemo()")
    page.evaluate("() => LuminaOS.runIntent('Make the reconstructed sky golden hour')")
    print(page.evaluate("() => LuminaOS.getGraph()['nodes']"))
    browser.close()
```

### Curl

Client-side app (no edit API server). Fetch the shell from Pinokio’s static host:

```bash
curl -I "http://localhost:<pinokio-app-port>/"
```

## Honest limits

Still a **client-side prototype**: depth/materials/DR are algorithmic heuristics (not ML LIDAR or a spectral photon solver). Scenescape is depth-parallax + overlays, not full path-traced 3D. RAW uses embedded previews, not full sensor decode.
