/**
 * Top-left Tools mega-menu — full classic + Lumina photo-editor catalog.
 */
const LuminaToolsMenu = (() => {
  const CATALOG = [
    {
      id: "file",
      label: "File",
      items: [
        { id: "open", label: "Open Image…", action: "ui:open" },
        { id: "open-raw", label: "Open RAW preview…", action: "ui:openRaw" },
        { id: "open-project", label: "Open Project File…", action: "ui:openProject" },
        { id: "camera", label: "Live Camera…", action: "ui:camera" },
        { id: "record", label: "Record Video…", action: "ui:record" },
        { id: "save", label: "Save Project", action: "ui:save", needsScene: true },
        { id: "save-as", label: "Save Project As…", action: "ui:saveAs", needsScene: true },
        { id: "projects", label: "Recent Projects…", action: "ui:projects" },
        { id: "delete-project", label: "Delete Current Project…", action: "ui:deleteCurrent", needsScene: true },
        { id: "export-as", label: "Export Image As…", action: "ui:exportResize", needsScene: true },
        { id: "image-size-file", label: "Image Size…", action: "ui:imageSize", needsScene: true },
        { id: "export", label: "Export PNG + Sidecar…", action: "ui:export", needsScene: true },
        { id: "print", label: "Print…", action: "ui:print", needsScene: true },
        { id: "reset", label: "New Session", action: "ui:reset" },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        { id: "undo", label: "Undo", action: "ui:undo", needsScene: true },
        { id: "redo", label: "Redo", action: "ui:redo", needsScene: true },
        { id: "compare", label: "A/B Compare", action: "ui:compare", needsScene: true },
        { id: "graph", label: "Thought Graph", action: "ui:graph", needsScene: true },
        { id: "copy", label: "Copy Image", action: "ui:copy", needsScene: true },
        { id: "paste", label: "Paste Image", action: "ui:paste" },
        { id: "duplicate", label: "Duplicate as Branch", type: "branch", params: {}, needsScene: true },
      ],
    },
    {
      id: "zoom",
      label: "Zoom",
      items: [
        { id: "zoom-in", label: "Zoom In", action: "ui:zoomIn", needsScene: true },
        { id: "zoom-out", label: "Zoom Out", action: "ui:zoomOut", needsScene: true },
        { id: "zoom-fit", label: "Fit to Screen", action: "ui:zoomFit", needsScene: true },
        { id: "zoom-100", label: "Zoom 100% (Fit)", action: "ui:zoom100", needsScene: true },
        { id: "zoom-actual", label: "Actual Pixels (1:1)", action: "ui:zoomActual", needsScene: true },
        { id: "zoom-200", label: "Zoom 200%", action: "ui:zoom200", needsScene: true },
        { id: "zoom-400", label: "Zoom 400%", action: "ui:zoom400", needsScene: true },
        { id: "zoom-50", label: "Zoom 50%", action: "ui:zoom50", needsScene: true },
        { id: "pan-reset", label: "Reset Pan", action: "ui:panReset", needsScene: true },
      ],
    },
    {
      id: "image",
      label: "Image",
      items: [
        { id: "rotate-cw", label: "Rotate 90° CW", type: "transform", params: { rotate90: 1 }, needsScene: true },
        { id: "rotate-ccw", label: "Rotate 90° CCW", type: "transform", params: { rotate90: 3 }, needsScene: true },
        { id: "rotate-180", label: "Rotate 180°", type: "transform", params: { rotate90: 2 }, needsScene: true },
        { id: "flip-h", label: "Flip Horizontal", type: "transform", params: { flipH: 1 }, needsScene: true },
        { id: "flip-v", label: "Flip Vertical", type: "transform", params: { flipV: 1 }, needsScene: true },
        { id: "crop-center", label: "Apply Soft Crop 5%", type: "transform", params: { cropL: 0.05, cropT: 0.05, cropR: 0.95, cropB: 0.95 }, needsScene: true },
        { id: "straighten", label: "Straighten +2°", type: "transform", params: { straighten: 2 }, needsScene: true },
        { id: "straighten-neg", label: "Straighten −2°", type: "transform", params: { straighten: -2 }, needsScene: true },
        { id: "perspective", label: "Soft vignette + dehaze", type: "adjust", params: { vignette: 0.12, dehaze: 0.1 }, needsScene: true },
        { id: "canvas-size", label: "Lift vignette + fade", type: "adjust", params: { vignette: -0.05, fade: 0.08 }, needsScene: true },
        { id: "image-size", label: "Image Size…", action: "ui:imageSize", needsScene: true },
      ],
    },
    {
      id: "light",
      label: "Light",
      items: [
        { id: "auto-tone", label: "Auto Tone", type: "adjust", params: { exposure: 0.15, contrast: 0.12, shadows: 0.25, highlights: -0.1 }, needsScene: true },
        { id: "auto-contrast", label: "Auto Contrast", type: "adjust", params: { contrast: 0.28, blacks: 0.1, whites: 0.08 }, needsScene: true },
        { id: "exposure", label: "Exposure +", type: "adjust", params: { exposure: 0.35 }, needsScene: true, sliders: [{ key: "exposure", label: "Exposure", min: -1, max: 1, step: 0.01 }] },
        { id: "exposure-minus", label: "Exposure −", type: "adjust", params: { exposure: -0.3 }, needsScene: true },
        { id: "contrast", label: "Contrast", type: "adjust", params: { contrast: 0.25 }, needsScene: true, sliders: [{ key: "contrast", label: "Contrast", min: -1, max: 1, step: 0.01 }] },
        { id: "contrast-soft", label: "Soft Contrast", type: "adjust", params: { contrast: -0.2, fade: 0.1 }, needsScene: true },
        { id: "highlights", label: "Highlights Recover", type: "adjust", params: { highlights: -0.45 }, needsScene: true, sliders: [{ key: "highlights", label: "Highlights", min: -1, max: 1, step: 0.01 }] },
        { id: "highlights-boost", label: "Highlights Boost", type: "adjust", params: { highlights: 0.35 }, needsScene: true },
        { id: "shadows", label: "Lift Shadows", type: "adjust", params: { shadows: 0.45 }, needsScene: true, sliders: [{ key: "shadows", label: "Shadows", min: -1, max: 1, step: 0.01 }] },
        { id: "shadows-crush", label: "Crush Shadows", type: "adjust", params: { shadows: -0.35, blacks: 0.2 }, needsScene: true },
        { id: "whites", label: "Whites", type: "adjust", params: { whites: 0.2 }, needsScene: true, sliders: [{ key: "whites", label: "Whites", min: -1, max: 1, step: 0.01 }] },
        { id: "blacks", label: "Blacks", type: "adjust", params: { blacks: 0.2 }, needsScene: true, sliders: [{ key: "blacks", label: "Blacks", min: -1, max: 1, step: 0.01 }] },
        { id: "brilliance", label: "Brilliance", type: "adjust", params: { exposure: 0.1, vibrance: 0.2, clarity: 0.15 }, needsScene: true },
        { id: "hdr-look", label: "HDR Look", type: "adjust", params: { shadows: 0.4, highlights: -0.35, clarity: 0.35, contrast: 0.1 }, needsScene: true },
        { id: "flat", label: "Flat / Log-ish", type: "adjust", params: { contrast: -0.35, fade: 0.25, saturation: -0.1 }, needsScene: true },
      ],
    },
    {
      id: "color",
      label: "Color",
      items: [
        { id: "auto-wb", label: "Auto White Balance", type: "adjust", params: { temperature: -0.08, tint: 0.02 }, needsScene: true },
        { id: "auto-color", label: "Auto Color", type: "adjust", params: { vibrance: 0.2, saturation: 0.08, temperature: -0.05 }, needsScene: true },
        { id: "temp-warm", label: "Warm Temperature", type: "adjust", params: { temperature: 0.35 }, needsScene: true, sliders: [{ key: "temperature", label: "Temperature", min: -1, max: 1, step: 0.01 }] },
        { id: "temp-cool", label: "Cool Temperature", type: "adjust", params: { temperature: -0.35 }, needsScene: true },
        { id: "tint", label: "Tint Magenta", type: "adjust", params: { tint: 0.25 }, needsScene: true, sliders: [{ key: "tint", label: "Tint", min: -1, max: 1, step: 0.01 }] },
        { id: "tint-green", label: "Tint Green", type: "adjust", params: { tint: -0.25 }, needsScene: true },
        { id: "vibrance", label: "Vibrance", type: "adjust", params: { vibrance: 0.4 }, needsScene: true, sliders: [{ key: "vibrance", label: "Vibrance", min: -1, max: 1, step: 0.01 }] },
        { id: "saturation", label: "Saturation", type: "adjust", params: { saturation: 0.3 }, needsScene: true, sliders: [{ key: "saturation", label: "Saturation", min: -1, max: 1, step: 0.01 }] },
        { id: "desaturate", label: "Desaturate", type: "adjust", params: { saturation: -0.85 }, needsScene: true },
        { id: "hsl-boost", label: "HSL Pop", type: "adjust", params: { vibrance: 0.35, saturation: 0.15, contrast: 0.08 }, needsScene: true },
        { id: "hsl-mute", label: "HSL Mute", type: "adjust", params: { vibrance: -0.25, saturation: -0.2 }, needsScene: true },
        { id: "split-tone", label: "Split Tone", type: "adjust", params: { temperature: 0.2, tint: -0.1, shadows: 0.15, coolShift: 0.2 }, needsScene: true },
        { id: "color-grade", label: "Cinematic Grade", type: "adjust", params: { contrast: 0.2, temperature: 0.15, fade: 0.2, vignette: 0.25, saturation: -0.1 }, needsScene: true },
        { id: "teal-orange", label: "Teal & Orange", type: "adjust", params: { temperature: 0.2, tint: -0.15, contrast: 0.15, vibrance: 0.2 }, needsScene: true },
        { id: "lut-film", label: "Film LUT Look", type: "adjust", params: { fade: 0.3, grain: 0.25, contrast: 0.1, saturation: -0.05 }, needsScene: true },
        { id: "channel-red", label: "Boost Reds", type: "adjust", params: { temperature: 0.2, saturation: 0.15, vibrance: 0.1 }, needsScene: true },
        { id: "channel-blue", label: "Boost Blues", type: "adjust", params: { temperature: -0.25, coolShift: 0.35 }, needsScene: true },
      ],
    },
    {
      id: "tone",
      label: "Tone Curve",
      items: [
        { id: "curve-s", label: "S-Curve Contrast", type: "adjust", params: { contrast: 0.35, blacks: 0.1, whites: 0.1 }, needsScene: true },
        { id: "curve-lift", label: "Lift Midtones", type: "adjust", params: { exposure: 0.12, shadows: 0.2, fade: 0.1 }, needsScene: true },
        { id: "curve-crush", label: "Crush Blacks", type: "adjust", params: { blacks: 0.35, contrast: 0.15 }, needsScene: true },
        { id: "curve-soft", label: "Soft Highlights", type: "adjust", params: { highlights: -0.3, fade: 0.15 }, needsScene: true },
        { id: "levels-auto", label: "Auto Levels", type: "adjust", params: { contrast: 0.2, blacks: 0.12, whites: 0.12, exposure: 0.05 }, needsScene: true },
        { id: "gamma-bright", label: "Gamma Bright", type: "adjust", params: { exposure: 0.2, shadows: 0.25 }, needsScene: true },
        { id: "gamma-dark", label: "Gamma Dark", type: "adjust", params: { exposure: -0.15, blacks: 0.15 }, needsScene: true },
      ],
    },
    {
      id: "detail",
      label: "Detail",
      items: [
        { id: "clarity", label: "Clarity", type: "adjust", params: { clarity: 0.45 }, needsScene: true, sliders: [{ key: "clarity", label: "Clarity", min: -1, max: 1, step: 0.01 }] },
        { id: "clarity-neg", label: "Negative Clarity", type: "adjust", params: { clarity: -0.4 }, needsScene: true },
        { id: "texture", label: "Texture", type: "adjust", params: { textureAdj: 0.4 }, needsScene: true, sliders: [{ key: "textureAdj", label: "Texture", min: -1, max: 1, step: 0.01 }] },
        { id: "dehaze", label: "Dehaze", type: "adjust", params: { dehaze: 0.45 }, needsScene: true, sliders: [{ key: "dehaze", label: "Dehaze", min: 0, max: 1, step: 0.01 }] },
        { id: "haze-add", label: "Add Haze", type: "adjust", params: { dehaze: -0.2, fade: 0.2, atmosphericHaze: 0.5 }, needsScene: true },
        { id: "sharpen", label: "Sharpen", type: "adjust", params: { sharpen: 0.45 }, needsScene: true, sliders: [{ key: "sharpen", label: "Sharpen", min: 0, max: 1, step: 0.01 }] },
        { id: "sharpen-strong", label: "Sharpen Strong", type: "adjust", params: { sharpen: 0.75, clarity: 0.2 }, needsScene: true },
        { id: "noise", label: "Noise Reduction", type: "adjust", params: { noiseReduce: 0.45 }, needsScene: true, sliders: [{ key: "noiseReduce", label: "NR", min: 0, max: 1, step: 0.01 }] },
        { id: "noise-strong", label: "Strong NR", type: "adjust", params: { noiseReduce: 0.75 }, needsScene: true },
        { id: "soften", label: "Lens Softness", type: "adjust", params: { noiseReduce: 0.35, clarity: -0.2 }, needsScene: true },
        { id: "structure", label: "Structure", type: "adjust", params: { clarity: 0.35, textureAdj: 0.35, contrast: 0.1 }, needsScene: true },
      ],
    },
    {
      id: "optics",
      label: "Optics / Lens",
      items: [
        { id: "vignette", label: "Lens Vignette", type: "adjust", params: { vignette: 0.55 }, needsScene: true, sliders: [{ key: "vignette", label: "Vignette", min: 0, max: 1, step: 0.01 }] },
        { id: "vignette-white", label: "White Vignette", type: "adjust", params: { fade: 0.2, vignette: -0.1, exposure: 0.05 }, needsScene: true },
        { id: "chromatic", label: "CA Soften", type: "adjust", params: { noiseReduce: 0.2, dehaze: 0.1 }, needsScene: true },
        { id: "distortion", label: "Barrel Soft Fix", type: "adjust", params: { vignette: 0.1, clarity: -0.05 }, needsScene: true },
        { id: "defocus", label: "Background Defocus Look", type: "adjust", params: { noiseReduce: 0.4, clarity: -0.25, vignette: 0.2 }, needsScene: true },
        { id: "tilt-shift", label: "Tilt-Shift Mini", type: "adjust", params: { vignette: 0.45, contrast: 0.2, saturation: 0.15 }, needsScene: true },
      ],
    },
    {
      id: "retouch",
      label: "Retouch",
      items: [
        { id: "object-remove", label: "Erase Object…", action: "ui:erase", needsScene: true },
        { id: "content-aware", label: "Content-Aware Fill…", action: "ui:erase", needsScene: true },
        { id: "erase-subject", label: "Erase Subject (AI)", action: "ui:eraseSubject", needsScene: true },
        { id: "erase-undo", label: "Undo Last Erase", action: "ui:eraseUndo", needsScene: true },
        { id: "spot-heal", label: "Soften (global blur mix)", type: "heal", params: { heal: 0.55 }, needsScene: true },
        { id: "clone", label: "Paint blend mask…", action: "ui:paint", needsScene: true },
        { id: "patch", label: "Erase & fill…", action: "ui:erase", needsScene: true },
        { id: "dodge", label: "Dodge (Lighten)", type: "adjust", params: { dodge: 0.4 }, needsScene: true, sliders: [{ key: "dodge", label: "Dodge", min: 0, max: 1, step: 0.01 }] },
        { id: "burn", label: "Burn (Darken)", type: "adjust", params: { burn: 0.35 }, needsScene: true, sliders: [{ key: "burn", label: "Burn", min: 0, max: 1, step: 0.01 }] },
        { id: "sponge-desat", label: "Sponge Desaturate", type: "adjust", params: { saturation: -0.35 }, needsScene: true },
        { id: "sponge-sat", label: "Sponge Saturate", type: "adjust", params: { saturation: 0.35 }, needsScene: true },
        { id: "redeye", label: "Cool magenta (look)", type: "adjust", params: { tint: -0.15, saturation: -0.1 }, needsScene: true },
        { id: "blemishes", label: "Soften (light blur mix)", type: "heal", params: { heal: 0.5 }, needsScene: true },
        { id: "portrait", label: "Portrait Retouch", type: "portrait", params: { sssDepth: 0.55, surfaceTexture: 0.35, catchlight: 0.45 }, needsScene: true },
        { id: "face-retouch", label: "Face-Aware Soft Retouch", type: "portrait", params: { sssDepth: 0.6, noiseReduce: 0.35, surfaceTexture: -0.12, catchlight: 0.45 }, needsScene: true },
        { id: "eyes", label: "Eye Brighten", type: "portrait", params: { catchlight: 0.75, irisReflectance: 0.65 }, needsScene: true },
        { id: "skin", label: "Skin Smooth", type: "portrait", params: { sssDepth: 0.65, surfaceTexture: 0.2, noiseReduce: 0.2 }, needsScene: true },
        { id: "teeth", label: "Teeth Whiten Look", type: "adjust", params: { exposure: 0.08, temperature: -0.05, vibrance: -0.05 }, needsScene: true },
        { id: "liquify-soft", label: "Soften look", type: "adjust", params: { noiseReduce: 0.15, clarity: -0.1 }, needsScene: true },
      ],
    },
    {
      id: "effects",
      label: "Effects",
      items: [
        { id: "bw", label: "Black & White", type: "adjust", params: { bw: 1, contrast: 0.15 }, needsScene: true },
        { id: "bw-highkey", label: "B&W High Key", type: "adjust", params: { bw: 1, exposure: 0.25, fade: 0.15 }, needsScene: true },
        { id: "bw-lowkey", label: "B&W Low Key", type: "adjust", params: { bw: 1, exposure: -0.25, contrast: 0.25, vignette: 0.4 }, needsScene: true },
        { id: "sepia", label: "Sepia", type: "adjust", params: { sepia: 0.85, contrast: 0.05 }, needsScene: true },
        { id: "fade", label: "Film Fade", type: "adjust", params: { fade: 0.45, contrast: -0.05 }, needsScene: true },
        { id: "grain", label: "Film Grain", type: "adjust", params: { grain: 0.55 }, needsScene: true, sliders: [{ key: "grain", label: "Grain", min: 0, max: 1, step: 0.01 }] },
        { id: "vignette-fx", label: "Vignette", type: "adjust", params: { vignette: 0.55 }, needsScene: true },
        { id: "orton", label: "Orton Glow", type: "adjust", params: { noiseReduce: 0.3, exposure: 0.1, clarity: -0.2, fade: 0.15 }, needsScene: true },
        { id: "matte", label: "Matte Look", type: "adjust", params: { fade: 0.35, blacks: -0.2, contrast: 0.1 }, needsScene: true },
        { id: "cross-process", label: "Cross Process", type: "adjust", params: { temperature: -0.15, tint: 0.25, contrast: 0.2, saturation: 0.2 }, needsScene: true },
        { id: "invert", label: "Invert / Negative", type: "adjust", params: { invert: 1 }, needsScene: true },
        { id: "posterize", label: "Posterize", type: "adjust", params: { posterize: 0.7, contrast: 0.1 }, needsScene: true },
        { id: "solarize", label: "Solarize", type: "adjust", params: { solarize: 0.7 }, needsScene: true },
        { id: "duotone", label: "Duotone Warm", type: "adjust", params: { bw: 0.7, sepia: 0.45, contrast: 0.1 }, needsScene: true },
        { id: "infrared", label: "Infrared Look", type: "adjust", params: { bw: 0.5, exposure: 0.2, temperature: -0.2, clarity: 0.3 }, needsScene: true },
        { id: "glow", label: "Dream Glow", type: "adjust", params: { noiseReduce: 0.4, exposure: 0.15, fade: 0.2, clarity: -0.3 }, needsScene: true },
        { id: "noir", label: "Noir", type: "adjust", params: { bw: 1, contrast: 0.4, vignette: 0.5, grain: 0.3 }, needsScene: true },
      ],
    },
    {
      id: "filter",
      label: "Filters",
      items: [
        { id: "blur-gaussian", label: "Gaussian Soft", type: "adjust", params: { noiseReduce: 0.55 }, needsScene: true },
        { id: "blur-motion", label: "Motion Soft", type: "adjust", params: { noiseReduce: 0.4, clarity: -0.2 }, needsScene: true },
        { id: "emboss", label: "Emboss Look", type: "adjust", params: { clarity: 0.7, contrast: 0.3, bw: 0.4 }, needsScene: true },
        { id: "edge", label: "Find Edges", type: "adjust", params: { clarity: 0.9, sharpen: 0.6, bw: 0.6, contrast: 0.4 }, needsScene: true },
        { id: "oil", label: "Oil Paint Soft", type: "adjust", params: { noiseReduce: 0.45, textureAdj: 0.3, saturation: 0.15 }, needsScene: true },
        { id: "watercolor", label: "Watercolor Soft", type: "adjust", params: { noiseReduce: 0.35, fade: 0.15, clarity: -0.15, vibrance: 0.2 }, needsScene: true },
        { id: "pixelate", label: "Pixelate Soft", type: "adjust", params: { posterize: 0.55, noiseReduce: 0.2 }, needsScene: true },
        { id: "mosaic", label: "Mosaic Soft", type: "adjust", params: { posterize: 0.7, noiseReduce: 0.35 }, needsScene: true },
      ],
    },
    {
      id: "select",
      label: "Select & Mask",
      items: [
        { id: "select-sky", label: "Select Sky", action: "intent:select sky", needsScene: true },
        { id: "select-mountains", label: "Select Mountains", action: "intent:select mountains", needsScene: true },
        { id: "select-fg", label: "Select Foreground", action: "intent:select foreground", needsScene: true },
        { id: "select-skin", label: "Select Skin", action: "intent:select skin", needsScene: true },
        { id: "select-eyes", label: "Select Eyes", action: "intent:select eyes", needsScene: true },
        { id: "select-subject", label: "Select Subject (FG)", action: "intent:select foreground", needsScene: true },
        { id: "bg-remove", label: "Transparent Background", action: "ui:bgRemove", needsScene: true },
        { id: "studio-drop", label: "Studio Drop", action: "ui:studioDrop", needsScene: true },
        { id: "bg-replace", label: "Replace Background…", action: "ui:bgReplace", needsScene: true },
        { id: "bg-reset", label: "Reset Background", action: "ui:bgReset", needsScene: true },
        { id: "add-text", label: "Responsive Text Box", action: "ui:addText", needsScene: true },
        { id: "compose-panel", label: "Compose Panel…", action: "ui:compose", needsScene: true },
        { id: "mask-paint", label: "Paint Mask", action: "ui:paint", needsScene: true },
        { id: "mask-clear", label: "Clear Painted Mask", action: "ui:clearMask", needsScene: true },
        { id: "erase-panel", label: "Erase Panel…", action: "ui:erase", needsScene: true },
        { id: "mask-feather", label: "Feather Mask Soft", type: "adjust", params: { noiseReduce: 0.15 }, needsScene: true },
        { id: "blend", label: "Blend Selected Branches", action: "ui:blend", needsScene: true },
        { id: "blend-sky", label: "Blend Sky←Sunset", action: "ui:blend", needsScene: true },
      ],
    },
    {
      id: "layers",
      label: "Layers / Graph",
      items: [
        { id: "new-adj", label: "New Adjustment Layer", type: "adjust", params: { exposure: 0.05 }, needsScene: true },
        { id: "new-branch", label: "New Exploration Branch", type: "branch", params: {}, needsScene: true },
        { id: "merge-visible", label: "Merge via Blend", action: "ui:blend", needsScene: true },
        { id: "opacity-soft", label: "Soft Opacity Look", type: "adjust", params: { fade: 0.25 }, needsScene: true },
        { id: "overlay-mode", label: "Overlay Punch", type: "adjust", params: { contrast: 0.25, clarity: 0.2 }, needsScene: true },
        { id: "soft-light", label: "Soft Light", type: "adjust", params: { contrast: 0.12, exposure: 0.05 }, needsScene: true },
        { id: "multiply", label: "Multiply Darken", type: "adjust", params: { burn: 0.35, exposure: -0.1 }, needsScene: true },
        { id: "screen", label: "Screen Lighten", type: "adjust", params: { dodge: 0.35, exposure: 0.1 }, needsScene: true },
      ],
    },
    {
      id: "buka",
      label: "BUKA",
      items: [
        { id: "dr", label: "Quantum DR Recovery", action: "intent:Reconstruct sky detail from scattering", needsScene: true },
        { id: "sunset", label: "Golden Hour Relight", action: "intent:Make the reconstructed sky golden hour", needsScene: true },
        { id: "ambient", label: "Ambient Light Field", action: "intent:Shift ambient light to dramatic mood", needsScene: true },
        { id: "haze", label: "Atmospheric Density", action: "intent:Increase atmospheric haze", needsScene: true },
        { id: "cool", label: "Cool Spectral Shift", action: "intent:Cool spectral blue hour", needsScene: true },
        { id: "portrait-intent", label: "Portrait Material", action: "intent:portrait skin subsurface", needsScene: true },
        { id: "eye-intent", label: "Eye Reflectance", action: "intent:boost eye catchlight", needsScene: true },
        { id: "scenescape", label: "Enter Scenescape", action: "ui:scenescape", needsScene: true },
        { id: "photobase-l", label: "Return Photobase", action: "ui:photobase", needsScene: true },
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        { id: "photobase", label: "Photobase", action: "ui:photobase", needsScene: true },
        { id: "scenescape-view", label: "Scenescape (or hold Alt)", action: "ui:scenescape", needsScene: true },
        { id: "fit", label: "Fit to Screen", action: "ui:zoomFit", needsScene: true },
        { id: "zoom-in-v", label: "Zoom In", action: "ui:zoomIn", needsScene: true },
        { id: "zoom-out-v", label: "Zoom Out", action: "ui:zoomOut", needsScene: true },
        { id: "actual", label: "Actual Pixels", action: "ui:zoomActual", needsScene: true },
        { id: "histogram", label: "Toggle Histogram", action: "ui:histogram", needsScene: true },
        { id: "studio-rail", label: "Looks panel", action: "ui:studioRail", needsScene: true },
        { id: "fullscreen", label: "Toggle Fullscreen", action: "ui:fullscreen" },
        { id: "grid", label: "Rule-of-Thirds Hint", action: "ui:grid", needsScene: true },
      ],
    },
    {
      id: "help",
      label: "Help",
      items: [
        { id: "guide", label: "User Guide…", action: "ui:guide" },
        { id: "shortcuts", label: "Keyboard Shortcuts", action: "ui:guide" },
        { id: "about", label: "About BUKA PHOTO PRO", action: "ui:about" },
      ],
    },
  ];

  let root;
  let panel;
  let btn;
  let handlers = {};
  let open = false;
  let activeCat = "file";

  function init(el, h) {
    root = el;
    handlers = h || {};
    btn = root.querySelector("[data-tools-toggle]");
    panel = root.querySelector("[data-tools-panel]");
    render();
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(!open);
    });
    document.addEventListener("click", (e) => {
      if (!root.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(false);
    });
  }

  function setOpen(v) {
    open = v;
    root.dataset.open = open ? "true" : "false";
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function render() {
    const cats = panel.querySelector("[data-tools-cats]");
    const items = panel.querySelector("[data-tools-items]");
    cats.innerHTML = "";
    items.innerHTML = "";

    for (const cat of CATALOG) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tools-cat" + (cat.id === activeCat ? " active" : "");
      b.textContent = cat.label;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        activeCat = cat.id;
        render();
      });
      cats.appendChild(b);
    }

    const cat = CATALOG.find((c) => c.id === activeCat) || CATALOG[0];
    for (const item of cat.items) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "tools-item";
      row.innerHTML = `<span>${escapeHtml(item.label)}</span>`;
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        runItem(item);
        setOpen(false);
      });
      items.appendChild(row);
    }
  }

  function runItem(item) {
    if (item.needsScene && handlers.hasScene && !handlers.hasScene()) {
      handlers.toast?.("Open an image first");
      return;
    }
    if (item.action?.startsWith("ui:")) {
      handlers.ui?.(item.action.slice(3), item);
      return;
    }
    if (item.action?.startsWith("intent:")) {
      handlers.intent?.(item.action.slice(7));
      return;
    }
    if (item.action?.startsWith("toast:")) {
      handlers.toast?.(item.action.slice(6));
      return;
    }
    handlers.applyTool?.(item);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function getCatalog() {
    return CATALOG;
  }

  return { init, getCatalog, setOpen };
})();
