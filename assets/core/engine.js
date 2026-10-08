/**
 * Live render engine: applies Thought Graph DAG with masks, DR, relight, portrait ops.
 */
const LuminaEngine = (() => {
  const DEFAULT_PARAMS = {
    sunAngle: 35,
    azimuth: 0,
    atmosphericHaze: 0.35,
    bounceReflectance: 0.4,
    refractiveHaze: 0.25,
    cloudDensity: 0.45,
    catchlight: 0.5,
    irisReflectance: 0.4,
    sssDepth: 0.35,
    surfaceTexture: 0.4,
    goldenHour: 0,
    drRecovery: 0,
    coolShift: 0,
    // Classic photo adjustments
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    clarity: 0,
    textureAdj: 0,
    dehaze: 0,
    sharpen: 0,
    noiseReduce: 0,
    vignette: 0,
    grain: 0,
    bw: 0,
    sepia: 0,
    fade: 0,
    dodge: 0,
    burn: 0,
    invert: 0,
    posterize: 0,
    solarize: 0,
    rotate90: 0,
    flipH: 0,
    flipV: 0,
    straighten: 0,
    cropL: 0,
    cropT: 0,
    cropR: 1,
    cropB: 1,
    opacity: 1,
    heal: 0,
  };

  let scene = null;
  let entities = [];
  let displayCanvas = null;
  let displayCtx = null;
  let overlayCanvas = null;
  let overlayCtx = null;
  let viewMode = "photobase";
  let parallax = { x: 0, y: 0 };
  let orbit = { yaw: 0, pitch: 0 };
  let compareMode = false;
  let compareSplit = 0.5;
  let paintMask = null;
  let paintEntity = "sky";
  let regionLock = false;
  let softProof = false;
  let straightenPreview = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let lastOutput = null;
  let baseOutput = null;
  let zoom = 0.5;
  let pan = { x: 0, y: 0 };
  let onZoomChange = null;
  let onSourceChange = null;
  // Previous versions of scene.working.imageData, newest last. Pixel-level edits
  // such as erase rewrite the base the whole graph is evaluated from, so they
  // need their own undo stack alongside the graph's.
  let sourceHistory = [];
  const SOURCE_HISTORY_MAX = 12;
  const DEFAULT_OPEN_ZOOM = 0.5;

  function init(sceneEl, overlayEl) {
    displayCanvas = sceneEl;
    overlayCanvas = overlayEl;
    displayCtx = displayCanvas.getContext("2d");
    overlayCtx = overlayCanvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    for (const c of [displayCanvas, overlayCanvas]) {
      c.width = Math.floor(width * dpr);
      c.height = Math.floor(height * dpr);
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
    }
    displayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    present();
  }

  function getDefaultParams() {
    return { ...DEFAULT_PARAMS };
  }

  function setScene(next) {
    scene = next;
    entities = LuminaSegment.buildEntities(next);
    const w = next.working.w;
    const h = next.working.h;
    sourceHistory = [];
    paintMask = new Float32Array(w * h);
    baseOutput = cloneImageData(next.working.imageData);
    lastOutput = cloneImageData(next.working.imageData);
    zoom = DEFAULT_OPEN_ZOOM;
    pan = { x: 0, y: 0 };
    onZoomChange?.(getZoomState());
    if (typeof LuminaCompose !== "undefined") LuminaCompose.resetForScene(next);
  }

  function getScene() {
    return scene;
  }

  function getEntities() {
    return entities;
  }

  function setEntities(list) {
    entities = list;
  }

  function setViewMode(mode) {
    viewMode = mode;
    present();
  }

  function setParallax(x, y) {
    parallax = { x, y };
    if (viewMode === "scenescape") present();
  }

  function setOrbit(yaw, pitch) {
    orbit = { yaw, pitch };
    if (viewMode === "scenescape") present();
  }

  function setZoom(z, opts = {}) {
    const prev = zoom;
    zoom = Math.min(8, Math.max(0.1, z));
    if (opts.anchorX != null && opts.anchorY != null && prev > 0) {
      // Keep anchor screen point stable
      const ax = opts.anchorX - width / 2;
      const ay = opts.anchorY - height / 2;
      pan.x = ax - ((ax - pan.x) * zoom) / prev;
      pan.y = ay - ((ay - pan.y) * zoom) / prev;
    }
    if (zoom <= 1.001 && !opts.keepPan) {
      // soft recenter near fit
    }
    onZoomChange?.(getZoomState());
    present();
  }

  function zoomBy(factor, anchorX, anchorY) {
    setZoom(zoom * factor, { anchorX, anchorY });
  }

  function zoomIn(anchorX, anchorY) {
    zoomBy(1.25, anchorX ?? width / 2, anchorY ?? height / 2);
  }

  function zoomOut(anchorX, anchorY) {
    zoomBy(0.8, anchorX ?? width / 2, anchorY ?? height / 2);
  }

  function zoomFit() {
    zoom = 1;
    pan = { x: 0, y: 0 };
    onZoomChange?.(getZoomState());
    present();
  }

  function zoomActual() {
    if (!scene) return zoomFit();
    const fit = coverRect(scene.working.w, scene.working.h, width, height);
    const fitScale = fit.w / scene.working.w;
    // 1 screen pixel = 1 image pixel relative to fit cover
    setZoom(1 / fitScale, { keepPan: true });
    pan = { x: 0, y: 0 };
    onZoomChange?.(getZoomState());
    present();
  }

  function setPan(x, y) {
    pan = { x, y };
    present();
  }

  function panBy(dx, dy) {
    pan.x += dx;
    pan.y += dy;
    present();
  }

  function getZoomState() {
    return { zoom, pan: { ...pan }, percent: Math.round(zoom * 100) };
  }

  function setOnZoomChange(cb) {
    onZoomChange = cb;
  }

  function setOnSourceChange(cb) {
    onSourceChange = cb;
  }

  function getSourceImageData() {
    return scene ? scene.working.imageData : null;
  }

  /**
   * Replace the pixels the graph is evaluated from. Used by destructive tools
   * (erase / content-aware fill) whose result cannot be expressed as parameters.
   */
  function commitSource(next) {
    if (!scene || !next) return false;
    sourceHistory.push(scene.working.imageData);
    if (sourceHistory.length > SOURCE_HISTORY_MAX) sourceHistory.shift();
    scene.working.imageData = next;
    if (typeof LuminaBg !== "undefined") LuminaBg.invalidate();
    onSourceChange?.();
    return true;
  }

  function undoSource() {
    if (!scene || !sourceHistory.length) return false;
    scene.working.imageData = sourceHistory.pop();
    if (typeof LuminaBg !== "undefined") LuminaBg.invalidate();
    onSourceChange?.();
    return true;
  }

  function canUndoSource() {
    return sourceHistory.length > 0;
  }

  function sourceEditCount() {
    return sourceHistory.length;
  }

  function setCompare(on, split = 0.5) {
    compareMode = on;
    compareSplit = split;
    present();
  }

  function setRegionLock(on) {
    regionLock = !!on;
  }

  function setSoftProof(on) {
    softProof = !!on;
    present();
  }

  function setStraightenPreview(deg) {
    straightenPreview = deg || 0;
    present();
  }

  function getPaintMask() {
    return paintMask;
  }

  function setPaintEntity(id) {
    paintEntity = id;
  }

  function paintAt(nx, ny, radius = 0.04, value = 1) {
    if (!scene || !paintMask) return;
    const w = scene.working.w;
    const h = scene.working.h;
    const cx = nx * w;
    const cy = ny * h;
    const r = radius * Math.max(w, h);
    const r2 = r * r;
    for (let y = Math.max(0, cy - r); y < Math.min(h, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x < Math.min(w, cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) paintMask[y * w + x] = value;
      }
    }
  }

  function clearPaint() {
    if (paintMask) paintMask.fill(0);
  }

  function cloneImageData(imageData) {
    return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  }

  function mergeParams(nodeParams, globalFallbacks) {
    return { ...DEFAULT_PARAMS, ...globalFallbacks, ...nodeParams };
  }

  /**
   * Evaluate graph to produce output ImageData.
   * nodes: [{id,type,title,params,parents[]}]
   * activeId: optional leaf to evaluate to; else all sinks merged / last node
   */
  function evaluate(graphState, options = {}) {
    if (!scene) return null;
    const { nodes, edges } = graphState;
    if (!nodes?.length) return null;

    // When editing one graph leaf, skip unrelated branches. This keeps live
    // slider updates proportional to the selected path instead of the full DAG.
    let evalNodes = nodes;
    let evalEdges = edges;
    const requestedTarget = options.targetId;
    if (requestedTarget && nodes.some((n) => n.id === requestedTarget)) {
      const nodeIds = new Set(nodes.map((n) => n.id));
      const needed = new Set([requestedTarget]);
      const pending = [requestedTarget];
      while (pending.length) {
        const child = pending.pop();
        for (const edge of edges) {
          if (edge.to !== child || !nodeIds.has(edge.from) || needed.has(edge.from)) continue;
          needed.add(edge.from);
          pending.push(edge.from);
        }
      }
      evalNodes = nodes.filter((n) => needed.has(n.id));
      evalEdges = edges.filter((e) => needed.has(e.from) && needed.has(e.to));
    }

    const parentsOf = {};
    for (const n of evalNodes) parentsOf[n.id] = [];
    for (const e of evalEdges) {
      if (parentsOf[e.to]) parentsOf[e.to].push(e.from);
    }

    const buffers = new Map();
    const order = topoSort(evalNodes, evalEdges);
    const w = scene.working.w;
    const h = scene.working.h;

    for (const node of order) {
      const parents = parentsOf[node.id] || [];
      let input;
      if (!parents.length) {
        input = cloneImageData(scene.working.imageData);
      } else if (parents.length === 1) {
        input = cloneImageData(buffers.get(parents[0]) || scene.working.imageData);
      } else {
        // multi-parent without blend type: average
        input = cloneImageData(buffers.get(parents[0]));
      }

      const p = mergeParams(node.params, options.params || {});
      let output = input;

      switch (node.type) {
        case "ingest":
          output = input;
          break;
        case "recover":
          output = LuminaReconstruct.recoverHighlights(
            input,
            w,
            h,
            p.drRecovery,
            scene.profile,
            scene.skyMask
          );
          output = applyAtmosphere(output, w, h, p, scene, 0.6);
          break;
        case "relight":
          output = applyRelight(input, w, h, p, scene);
          break;
        case "atmosphere":
          output = applyAtmosphere(input, w, h, p, scene, 1);
          break;
        case "grade":
          output = applyGrade(input, w, h, p);
          break;
        case "portrait":
          output = applyPortrait(input, w, h, p, scene);
          break;
        case "adjust":
          output = applyAdjust(input, w, h, p, regionLock ? paintMask : null);
          break;
        case "heal":
          output = applyHeal(input, w, h, p, paintMask);
          break;
        case "erase":
          // Marker only: the fill is already baked into the source pixels.
          output = input;
          break;
        case "transform":
          output = applyTransform(input, w, h, p);
          break;
        case "blend":
          output = applyBlend(buffers, parents, node, w, h, scene);
          break;
        case "branch":
          output = input;
          break;
        case "intent":
        default:
          output = applyAdjust(
            applyAtmosphere(applyRelight(input, w, h, p, scene), w, h, p, scene, 0.4),
            w,
            h,
            p,
            regionLock ? paintMask : null
          );
          break;
      }

      // Node-local entity refinements from HUD params stored on node
      if (node.meta?.entityId) {
        output = applyEntityPolish(output, w, h, p, scene, node.meta.entityId);
      }

      // Layer opacity — blend node result with its input
      const opacity = Math.min(1, Math.max(0, node.opacity ?? p.opacity ?? 1));
      if (opacity < 0.999) {
        output = lerpImageData(input, output, opacity);
      }

      buffers.set(node.id, output);
    }

    const targetId = options.targetId || order[order.length - 1]?.id;
    lastOutput = buffers.get(targetId) || cloneImageData(scene.working.imageData);
    baseOutput = buffers.get(nodes.find((n) => n.type === "ingest")?.id) || cloneImageData(scene.working.imageData);
    present();
    return lastOutput;
  }

  let evalRaf = 0;
  let pendingEval = null;

  function scheduleEvaluate(graphState, options = {}) {
    pendingEval = { graphState, options };
    if (evalRaf) return;
    evalRaf = requestAnimationFrame(() => {
      evalRaf = 0;
      const job = pendingEval;
      pendingEval = null;
      if (job) evaluate(job.graphState, job.options);
    });
  }

  function topoSort(nodes, edges) {
    const indeg = {};
    const kids = {};
    for (const n of nodes) {
      indeg[n.id] = 0;
      kids[n.id] = [];
    }
    for (const e of edges) {
      if (indeg[e.to] !== undefined) {
        indeg[e.to]++;
        kids[e.from]?.push(e.to);
      }
    }
    const q = nodes.filter((n) => indeg[n.id] === 0).map((n) => n.id);
    const out = [];
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    while (q.length) {
      const id = q.shift();
      out.push(byId[id]);
      for (const k of kids[id] || []) {
        indeg[k]--;
        if (indeg[k] === 0) q.push(k);
      }
    }
    // append orphans
    for (const n of nodes) if (!out.includes(n)) out.push(n);
    return out;
  }

  function applyRelight(imageData, w, h, p, sc) {
    const out = cloneImageData(imageData);
    const d = out.data;
    const depth = sc.depth;
    const sun = (p.sunAngle / 90) * Math.PI * 0.5;
    const az = ((p.azimuth || sc.lightField.azimuth) * Math.PI) / 180;
    const gx = Math.cos(sun) * Math.sin(az + Math.PI / 2);
    const gy = -Math.sin(sun);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = i * 4;
        const z = depth[i];
        // Fake normal from depth
        const zx = x < w - 1 ? depth[i + 1] - z : 0;
        const zy = y < h - 1 ? depth[i + w] - z : 0;
        const ndot = Math.max(0, (-zx * gx - zy * gy + 0.35) / 1.2);
        const warm = p.goldenHour;
        const shadow = 1 - (1 - z) * warm * 0.45 * (1 - ndot);
        const bounce = 1 + p.bounceReflectance * warm * z * 0.25;

        let r = d[o] / 255;
        let g = d[o + 1] / 255;
        let b = d[o + 2] / 255;

        r *= shadow * bounce;
        g *= shadow * (0.95 + bounce * 0.05);
        b *= shadow * (0.85 + (1 - warm) * 0.15);

        // Golden wash from sun direction
        if (warm > 0.01) {
          const nx = x / w;
          const ny = y / h;
          const sunX = 0.2 + Math.cos(sun) * 0.5;
          const sunY = 0.05 + Math.sin(sun) * 0.25;
          const dist = Math.hypot(nx - sunX, ny - sunY);
          const glow = Math.max(0, 1 - dist * 1.4) * warm;
          r = r * (1 - glow * 0.3) + (1.0) * glow * 0.55 + r * glow * 0.2;
          g = g * (1 - glow * 0.25) + 0.72 * glow * 0.45 + g * glow * 0.2;
          b = b * (1 - glow * 0.4) + 0.28 * glow * 0.25;
        }

        d[o] = clamp255(r * 255);
        d[o + 1] = clamp255(g * 255);
        d[o + 2] = clamp255(b * 255);
      }
    }
    return out;
  }

  function applyAtmosphere(imageData, w, h, p, sc, strength) {
    const out = cloneImageData(imageData);
    const d = out.data;
    const depth = sc.depth;
    const haze = (p.atmosphericHaze * 0.5 + p.refractiveHaze * 0.5) * strength;
    const clouds = p.cloudDensity * strength;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = i * 4;
        const far = 1 - depth[i];
        const a = haze * far;
        const hr = p.coolShift > 0.2 ? 180 : 210;
        const hg = p.coolShift > 0.2 ? 210 : 225;
        const hb = p.coolShift > 0.2 ? 235 : 235;
        d[o] = clamp255(d[o] * (1 - a) + hr * a);
        d[o + 1] = clamp255(d[o + 1] * (1 - a) + hg * a);
        d[o + 2] = clamp255(d[o + 2] * (1 - a) + hb * a);

        if (clouds > 0.05 && sc.materials[i] === 0) {
          const n = hash2(x, y);
          if (n > 0.65) {
            const c = (n - 0.65) * clouds * 180;
            d[o] = clamp255(d[o] + c);
            d[o + 1] = clamp255(d[o + 1] + c);
            d[o + 2] = clamp255(d[o + 2] + c * 0.95);
          }
        }
      }
    }
    return out;
  }

  function applyGrade(imageData, w, h, p) {
    return applyAdjust(imageData, w, h, { ...p, coolShift: p.coolShift || 0.5 });
  }

  function applyTransform(imageData, w, h, p) {
    const turns = ((p.rotate90 || 0) % 4 + 4) % 4;
    let out = cloneImageData(imageData);
    let cw = w;
    let ch = h;
    for (let t = 0; t < turns; t++) {
      const rotated = new ImageData(ch, cw);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const si = (y * cw + x) * 4;
          const dx = ch - 1 - y;
          const dy = x;
          const di = (dy * ch + dx) * 4;
          rotated.data[di] = out.data[si];
          rotated.data[di + 1] = out.data[si + 1];
          rotated.data[di + 2] = out.data[si + 2];
          rotated.data[di + 3] = out.data[si + 3];
        }
      }
      out = rotated;
      [cw, ch] = [ch, cw];
    }
    if (p.flipH) {
      const flipped = new ImageData(cw, ch);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const si = (y * cw + x) * 4;
          const di = (y * cw + (cw - 1 - x)) * 4;
          flipped.data[di] = out.data[si];
          flipped.data[di + 1] = out.data[si + 1];
          flipped.data[di + 2] = out.data[si + 2];
          flipped.data[di + 3] = out.data[si + 3];
        }
      }
      out = flipped;
    }
    if (p.flipV) {
      const flipped = new ImageData(cw, ch);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const si = (y * cw + x) * 4;
          const di = ((ch - 1 - y) * cw + x) * 4;
          flipped.data[di] = out.data[si];
          flipped.data[di + 1] = out.data[si + 1];
          flipped.data[di + 2] = out.data[si + 2];
          flipped.data[di + 3] = out.data[si + 3];
        }
      }
      out = flipped;
    }

    const ang = p.straighten || 0;
    const hasCrop = (p.cropL || 0) > 0.001 || (p.cropT || 0) > 0.001 || (p.cropR || 1) < 0.999 || (p.cropB || 1) < 0.999;
    if (ang || hasCrop) {
      const c = document.createElement("canvas");
      c.width = cw;
      c.height = ch;
      c.getContext("2d").putImageData(out, 0, 0);
      const dest = document.createElement("canvas");
      dest.width = w;
      dest.height = h;
      const dctx = dest.getContext("2d");
      dctx.save();
      dctx.translate(w / 2, h / 2);
      if (ang) dctx.rotate((ang * Math.PI) / 180);
      const cl = (p.cropL || 0) * cw;
      const ct = (p.cropT || 0) * ch;
      const cr = (p.cropR ?? 1) * cw;
      const cb = (p.cropB ?? 1) * ch;
      const sw = Math.max(1, cr - cl);
      const sh = Math.max(1, cb - ct);
      dctx.drawImage(c, cl, ct, sw, sh, -w / 2, -h / 2, w, h);
      dctx.restore();
      return dctx.getImageData(0, 0, w, h);
    }

    // If size changed, resample back to scene working size for graph consistency
    if (cw !== w || ch !== h) {
      const c = document.createElement("canvas");
      c.width = cw;
      c.height = ch;
      c.getContext("2d").putImageData(out, 0, 0);
      const dest = document.createElement("canvas");
      dest.width = w;
      dest.height = h;
      const dctx = dest.getContext("2d");
      dctx.drawImage(c, 0, 0, w, h);
      return dctx.getImageData(0, 0, w, h);
    }
    return out;
  }

  function applyAdjust(imageData, w, h, p, mask = null) {
    const out = cloneImageData(imageData);
    const d = out.data;
    const src = imageData.data;
    const exposure = p.exposure || 0;
    const contrast = p.contrast || 0;
    const highlights = p.highlights || 0;
    const shadows = p.shadows || 0;
    const whites = p.whites || 0;
    const blacks = p.blacks || 0;
    const temperature = p.temperature || 0;
    const tint = p.tint || 0;
    const vibrance = p.vibrance || 0;
    const saturation = p.saturation || 0;
    const clarity = p.clarity || 0;
    const textureAdj = p.textureAdj || 0;
    const dehaze = p.dehaze || 0;
    const sharpen = p.sharpen || 0;
    const noiseReduce = p.noiseReduce || 0;
    const vignette = p.vignette || 0;
    const grain = p.grain || 0;
    const bw = p.bw || 0;
    const sepia = p.sepia || 0;
    const fade = p.fade || 0;
    const dodge = p.dodge || 0;
    const burn = p.burn || 0;
    const cool = p.coolShift || 0;

    const expMul = Math.pow(2, exposure);
    const contrastF = 1 + contrast;

    // Optional blur buffer for noise reduction / sharpen unsharp
    let blur = null;
    if (noiseReduce > 0.01 || sharpen > 0.01 || clarity > 0.01) {
      blur = boxBlur(out, w, h, noiseReduce > 0.01 ? 1 : 1);
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const m = mask ? mask[y * w + x] : 1;
        if (m < 0.01) continue;

        let r = d[i] / 255;
        let g = d[i + 1] / 255;
        let b = d[i + 2] / 255;

        // Exposure
        r *= expMul;
        g *= expMul;
        b *= expMul;

        // Contrast around mid gray
        r = (r - 0.5) * contrastF + 0.5;
        g = (g - 0.5) * contrastF + 0.5;
        b = (b - 0.5) * contrastF + 0.5;

        let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        // Highlights / shadows
        if (lum > 0.55) {
          const t = (lum - 0.55) / 0.45;
          const hMul = 1 + highlights * 0.5 * t;
          r *= hMul;
          g *= hMul;
          b *= hMul;
        } else if (lum < 0.45) {
          const t = (0.45 - lum) / 0.45;
          const sAdd = shadows * 0.35 * t;
          r += sAdd;
          g += sAdd;
          b += sAdd;
        }

        // Whites / blacks
        r += whites * 0.15 * lum;
        g += whites * 0.15 * lum;
        b += whites * 0.15 * lum;
        r -= blacks * 0.15 * (1 - lum);
        g -= blacks * 0.15 * (1 - lum);
        b -= blacks * 0.15 * (1 - lum);

        // White balance temperature / tint
        r += temperature * 0.12;
        b -= temperature * 0.12;
        g += tint * 0.08;
        r -= tint * 0.04;
        b -= tint * 0.04;

        // Dehaze (local contrast + blue pull)
        if (dehaze) {
          r = r * (1 + dehaze * 0.15) - dehaze * 0.04;
          g = g * (1 + dehaze * 0.12) - dehaze * 0.03;
          b = b * (1 + dehaze * 0.08) - dehaze * 0.06;
        }

        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        // Vibrance / saturation
        const satAmt = saturation + vibrance * (1 - Math.max(r, g, b) + Math.min(r, g, b));
        r = lum + (r - lum) * (1 + satAmt);
        g = lum + (g - lum) * (1 + satAmt);
        b = lum + (b - lum) * (1 + satAmt);

        // Clarity / texture via unsharp against blur
        if (blur && (clarity || textureAdj || sharpen)) {
          const br = blur.data[i] / 255;
          const bg = blur.data[i + 1] / 255;
          const bb = blur.data[i + 2] / 255;
          const amt = clarity * 0.55 + textureAdj * 0.35 + sharpen * 0.7;
          r += (r - br) * amt;
          g += (g - bg) * amt;
          b += (b - bb) * amt;
        }

        if (blur && noiseReduce > 0.01) {
          const br = blur.data[i] / 255;
          const bg = blur.data[i + 1] / 255;
          const bb = blur.data[i + 2] / 255;
          r = r * (1 - noiseReduce) + br * noiseReduce;
          g = g * (1 - noiseReduce) + bg * noiseReduce;
          b = b * (1 - noiseReduce) + bb * noiseReduce;
        }

        // Dodge / burn
        if (dodge) {
          r += dodge * 0.2 * (1 - lum);
          g += dodge * 0.2 * (1 - lum);
          b += dodge * 0.2 * (1 - lum);
        }
        if (burn) {
          r *= 1 - burn * 0.25 * lum;
          g *= 1 - burn * 0.25 * lum;
          b *= 1 - burn * 0.25 * lum;
        }

        // Cool shift leftover
        if (cool) {
          r *= 1 - cool * 0.12;
          b *= 1 + cool * 0.18;
        }

        // Invert / posterize / solarize
        if (p.invert > 0.01) {
          r = r * (1 - p.invert) + (1 - r) * p.invert;
          g = g * (1 - p.invert) + (1 - g) * p.invert;
          b = b * (1 - p.invert) + (1 - b) * p.invert;
        }
        if (p.posterize > 0.01) {
          const levels = Math.max(2, Math.round(2 + (1 - p.posterize) * 14));
          r = Math.round(r * levels) / levels;
          g = Math.round(g * levels) / levels;
          b = Math.round(b * levels) / levels;
        }
        if (p.solarize > 0.01) {
          const thr = 0.5;
          if (r > thr) r = 1 - (r - thr) * p.solarize * 2;
          if (g > thr) g = 1 - (g - thr) * p.solarize * 2;
          if (b > thr) b = 1 - (b - thr) * p.solarize * 2;
        }

        // B&W / sepia / fade
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (bw > 0.01) {
          r = r * (1 - bw) + lum * bw;
          g = g * (1 - bw) + lum * bw;
          b = b * (1 - bw) + lum * bw;
        }
        if (sepia > 0.01) {
          const sr = Math.min(1, lum * 1.15 + 0.1);
          const sg = Math.min(1, lum * 0.95 + 0.05);
          const sb = Math.min(1, lum * 0.7);
          r = r * (1 - sepia) + sr * sepia;
          g = g * (1 - sepia) + sg * sepia;
          b = b * (1 - sepia) + sb * sepia;
        }
        if (fade > 0.01) {
          r = r * (1 - fade * 0.35) + 0.5 * fade * 0.35;
          g = g * (1 - fade * 0.35) + 0.5 * fade * 0.35;
          b = b * (1 - fade * 0.35) + 0.5 * fade * 0.35;
        }

        // Vignette
        if (vignette > 0.01) {
          const nx = x / w - 0.5;
          const ny = y / h - 0.5;
          const dist = Math.sqrt(nx * nx * 2.2 + ny * ny * 2.2);
          const v = Math.max(0, 1 - Math.max(0, dist - 0.35) * vignette * 1.8);
          r *= v;
          g *= v;
          b *= v;
        }

        // Grain
        if (grain > 0.01) {
          const n = (hash2(x, y) - 0.5) * grain * 0.18;
          r += n;
          g += n;
          b += n;
        }

        let rr = clamp255(r * 255);
        let gg = clamp255(g * 255);
        let bb = clamp255(b * 255);
        if (m < 0.999) {
          rr = Math.round(src[i] * (1 - m) + rr * m);
          gg = Math.round(src[i + 1] * (1 - m) + gg * m);
          bb = Math.round(src[i + 2] * (1 - m) + bb * m);
        }
        d[i] = rr;
        d[i + 1] = gg;
        d[i + 2] = bb;
      }
    }
    return out;
  }

  function lerpImageData(a, b, t) {
    const out = cloneImageData(a);
    const ad = a.data;
    const bd = b.data;
    const od = out.data;
    for (let i = 0; i < od.length; i += 4) {
      od[i] = ad[i] * (1 - t) + bd[i] * t;
      od[i + 1] = ad[i + 1] * (1 - t) + bd[i + 1] * t;
      od[i + 2] = ad[i + 2] * (1 - t) + bd[i + 2] * t;
    }
    return out;
  }

  function applyHeal(imageData, w, h, p, mask) {
    const strength = p.heal || p.noiseReduce || 0.45;
    const blurred = boxBlur(imageData, w, h);
    const out = cloneImageData(imageData);
    const d = out.data;
    const s = imageData.data;
    const b = blurred.data;
    for (let i = 0; i < w * h; i++) {
      const m = mask ? mask[i] : 1;
      if (m < 0.01) continue;
      const o = i * 4;
      const t = strength * m;
      d[o] = s[o] * (1 - t) + b[o] * t;
      d[o + 1] = s[o + 1] * (1 - t) + b[o + 1] * t;
      d[o + 2] = s[o + 2] * (1 - t) + b[o + 2] * t;
    }
    return out;
  }

  function boxBlur(imageData, w, h) {
    const src = imageData.data;
    const out = new ImageData(w, h);
    const dst = out.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const i = (yy * w + xx) * 4;
            r += src[i];
            g += src[i + 1];
            b += src[i + 2];
            n++;
          }
        }
        const o = (y * w + x) * 4;
        dst[o] = r / n;
        dst[o + 1] = g / n;
        dst[o + 2] = b / n;
        dst[o + 3] = 255;
      }
    }
    return out;
  }

  function applyPortrait(imageData, w, h, p, sc) {
    const out = cloneImageData(imageData);
    const skin = LuminaReconstruct.buildEntityMask("skin", sc.materials, sc.depth, w, h, sc.faces);
    const eyes = LuminaReconstruct.buildEntityMask("eyes", sc.materials, sc.depth, w, h, sc.faces);
    const d = out.data;

    for (let i = 0; i < skin.length; i++) {
      const o = i * 4;
      if (skin[i] > 0.05) {
        const a = skin[i] * p.sssDepth;
        // soft subsurface warm lift
        d[o] = clamp255(d[o] * (1 - a * 0.15) + (d[o] + 18) * a * 0.5 + d[o] * (1 - a * 0.35));
        d[o + 1] = clamp255(d[o + 1] * (1 - a * 0.1) + (d[o + 1] + 8) * a * 0.4);
        // pore/texture: subtle local contrast
        const t = p.surfaceTexture * skin[i] * 0.35;
        const lum = (d[o] + d[o + 1] + d[o + 2]) / 3;
        d[o] = clamp255(d[o] + (d[o] - lum) * t);
        d[o + 1] = clamp255(d[o + 1] + (d[o + 1] - lum) * t);
        d[o + 2] = clamp255(d[o + 2] + (d[o + 2] - lum) * t);
      }
      if (eyes[i] > 0.05) {
        const a = eyes[i];
        d[o] = clamp255(d[o] + 40 * p.catchlight * a);
        d[o + 1] = clamp255(d[o + 1] + 40 * p.catchlight * a);
        d[o + 2] = clamp255(d[o + 2] + 35 * p.catchlight * a);
        d[o] = clamp255(d[o] * (1 + p.irisReflectance * a * 0.15));
        d[o + 2] = clamp255(d[o + 2] * (1 + p.irisReflectance * a * 0.2));
      }
    }
    return out;
  }

  function applyEntityPolish(imageData, w, h, p, sc, entityId) {
    if (entityId === "eyes" || entityId === "skin") return applyPortrait(imageData, w, h, p, sc);
    if (entityId === "sky") return applyAtmosphere(imageData, w, h, p, sc, 0.8);
    if (entityId === "mountains" || entityId === "foreground") return applyRelight(imageData, w, h, p, sc);
    return imageData;
  }

  function applyBlend(buffers, parents, node, w, h, sc) {
    if (parents.length < 2) return cloneImageData(buffers.get(parents[0]) || sc.working.imageData);
    const a = buffers.get(parents[0]);
    const b = buffers.get(parents[1]);
    const out = cloneImageData(a);
    const maskSpec = node.meta?.mask || { sky: "b", mountains: "a", foreground: "a" };

    const masks = {
      sky: LuminaReconstruct.buildEntityMask("sky", sc.materials, sc.depth, w, h, sc.faces),
      mountains: LuminaReconstruct.buildEntityMask("mountains", sc.materials, sc.depth, w, h, sc.faces),
      foreground: LuminaReconstruct.buildEntityMask("foreground", sc.materials, sc.depth, w, h, sc.faces),
    };

    // Optional painted override
    const painted = paintMask;

    const da = a.data;
    const db = b.data;
    const d = out.data;

    for (let i = 0; i < w * h; i++) {
      let chooseB = 0;
      // Default: sky from sunset branch (b), rest from daylight (a)
      chooseB = masks.sky[i] * (maskSpec.sky === "b" || maskSpec.sky === parents[1] ? 1 : 0);
      chooseB = Math.max(
        chooseB,
        masks.mountains[i] * (maskSpec.mountains === "b" || maskSpec.mountains === parents[1] ? 1 : 0)
      );
      chooseB = Math.max(
        chooseB,
        masks.foreground[i] * (maskSpec.foreground === "b" || maskSpec.foreground === parents[1] ? 1 : 0)
      );
      if (painted && painted[i] > 0.05) {
        chooseB = painted[i];
      }
      const o = i * 4;
      const t = Math.min(1, chooseB);
      d[o] = da[o] * (1 - t) + db[o] * t;
      d[o + 1] = da[o + 1] * (1 - t) + db[o + 1] * t;
      d[o + 2] = da[o + 2] * (1 - t) + db[o + 2] * t;
    }
    return out;
  }

  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function hash2(x, y) {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  function coverRect(imgW, imgH, cw, ch) {
    const scale = Math.max(cw / imgW, ch / imgH);
    const w = imgW * scale;
    const h = imgH * scale;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }

  function present() {
    if (!displayCtx) return;
    displayCtx.clearRect(0, 0, width, height);
    overlayCtx.clearRect(0, 0, width, height);
    if (!scene || !lastOutput) {
      displayCtx.fillStyle = "#0b0d10";
      displayCtx.fillRect(0, 0, width, height);
      return;
    }

    const tmp = scene.working.canvas;
    const tctx = scene.working.ctx;
    const useCompose = typeof LuminaCompose !== "undefined" && LuminaCompose.active();
    if (useCompose) {
      tctx.save();
      LuminaCompose.paintFrame(tctx, lastOutput, scene, { forExport: false });
      tctx.restore();
    } else {
      tctx.putImageData(lastOutput, 0, 0);
    }

    const rect = coverRect(tmp.width, tmp.height, width, height);
    const px = (viewMode === "scenescape" ? parallax.x * 36 + orbit.yaw * 40 : 0) + pan.x;
    const py = (viewMode === "scenescape" ? parallax.y * 22 + orbit.pitch * 28 : 0) + pan.y;
    const scaleBoost = (viewMode === "scenescape" ? 1.06 + Math.abs(orbit.yaw) * 0.02 : 1) * zoom;

    displayCtx.save();
    displayCtx.translate(width / 2 + px, height / 2 + py);
    if (straightenPreview) displayCtx.rotate((straightenPreview * Math.PI) / 180);
    displayCtx.scale(scaleBoost, scaleBoost);
    displayCtx.translate(-width / 2, -height / 2);

    if (compareMode && baseOutput) {
      const splitX = width * compareSplit;
      displayCtx.save();
      displayCtx.beginPath();
      displayCtx.rect(0, 0, splitX, height);
      displayCtx.clip();
      tctx.putImageData(baseOutput, 0, 0);
      displayCtx.drawImage(tmp, rect.x, rect.y, rect.w, rect.h);
      displayCtx.restore();

      displayCtx.save();
      displayCtx.beginPath();
      displayCtx.rect(splitX, 0, width - splitX, height);
      displayCtx.clip();
      if (useCompose) {
        LuminaCompose.paintFrame(tctx, lastOutput, scene, { forExport: false });
      } else {
        tctx.putImageData(lastOutput, 0, 0);
      }
      displayCtx.drawImage(tmp, rect.x, rect.y, rect.w, rect.h);
      displayCtx.restore();

      displayCtx.fillStyle = "rgba(236,240,244,0.85)";
      displayCtx.fillRect(splitX - 1, 0, 2, height);
    } else {
      displayCtx.drawImage(tmp, rect.x, rect.y, rect.w, rect.h);

      // Depth-based layered parallax strips in scenescape
      if (viewMode === "scenescape") {
        drawDepthLayers(displayCtx, tmp, rect);
      }
    }
    displayCtx.restore();

    if (softProof) {
      displayCtx.fillStyle = "rgba(180, 210, 230, 0.06)";
      displayCtx.fillRect(0, 0, width, height);
    }

    // Never draw clipping false-color over the live view (it mottled the whole UI).
    const clip = document.getElementById("clipOverlay");
    if (clip) {
      clip.hidden = true;
      clip.style.opacity = "0";
    }

    if (viewMode === "scenescape") drawScenescapeOverlay();
    if (typeof LuminaCompose !== "undefined") LuminaCompose.syncTextLayer();
    if (typeof LuminaErase !== "undefined") LuminaErase.syncOverlay();
  }

  function updateClipOverlay() {
    /* Disabled — was painting blue crush warnings across the viewport */
    const clip = document.getElementById("clipOverlay");
    if (clip) {
      clip.hidden = true;
      clip.style.opacity = "0";
    }
  }

  let depthLayerCanvas = null;

  function drawDepthLayers(ctx, srcCanvas, rect) {
    // Additional far/near shifts for volumetric feel
    if (!depthLayerCanvas || depthLayerCanvas.width !== srcCanvas.width || depthLayerCanvas.height !== srcCanvas.height) {
      depthLayerCanvas = document.createElement("canvas");
      depthLayerCanvas.width = srcCanvas.width;
      depthLayerCanvas.height = srcCanvas.height;
    }
    const off = depthLayerCanvas;
    const ox = off.getContext("2d");
    ox.clearRect(0, 0, off.width, off.height);
    ox.drawImage(srcCanvas, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.drawImage(off, rect.x - parallax.x * 10, rect.y - parallax.y * 6, rect.w, rect.h);
    ctx.globalAlpha = 0.25;
    ctx.drawImage(off, rect.x + parallax.x * 14, rect.y + parallax.y * 10, rect.w, rect.h);
    ctx.restore();
  }

  function drawScenescapeOverlay() {
    const c = overlayCtx;
    const p = scene?.lightField || {};
    const sunAngle = (lastParams().sunAngle || p.sunAngle || 35);
    c.save();
    c.strokeStyle = "rgba(126,200,200,0.28)";
    c.lineWidth = 1;
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 14; x++) {
        const px = ((x + 0.5) / 14) * width;
        const py = ((y + 0.5) / 10) * height;
        const nx = px / width;
        const ny = py / height;
        const di = sampleDepth(nx, ny);
        const len = 5 + di * 16;
        const ang = (-sunAngle * Math.PI) / 180 + di;
        c.beginPath();
        c.moveTo(px, py);
        c.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
        c.stroke();
      }
    }
    const ang = (sunAngle / 90) * Math.PI * 0.5;
    const sx = width * (0.15 + Math.cos(ang) * 0.55);
    const sy = height * (0.08 + Math.sin(ang) * 0.2);
    c.strokeStyle = "rgba(232,164,92,0.75)";
    c.fillStyle = "rgba(232,164,92,0.9)";
    c.beginPath();
    c.moveTo(sx, sy);
    c.lineTo(width * 0.55, height * 0.48);
    c.stroke();
    c.beginPath();
    c.arc(sx, sy, 5, 0, Math.PI * 2);
    c.fill();

    // Camera frustum hint
    c.strokeStyle = "rgba(236,240,244,0.2)";
    c.strokeRect(width * 0.2, height * 0.15, width * 0.6, height * 0.6);
    c.restore();
  }

  let _lastParams = { ...DEFAULT_PARAMS };
  function lastParams() {
    return _lastParams;
  }
  function setLastParams(p) {
    _lastParams = { ...DEFAULT_PARAMS, ...p };
  }

  function sampleDepth(nx, ny) {
    if (!scene) return ny;
    const { depth, working } = scene;
    const x = Math.min(working.w - 1, Math.max(0, Math.floor(nx * working.w)));
    const y = Math.min(working.h - 1, Math.max(0, Math.floor(ny * working.h)));
    return depth[y * working.w + x];
  }

  function entityScreenBounds(entity) {
    const r = entity.region;
    return {
      x: ((r.x0 + r.x1) / 2) * width,
      y: ((r.y0 + r.y1) / 2) * height,
      left: r.x0 * width,
      top: r.y0 * height,
      right: r.x1 * width,
      bottom: r.y1 * height,
    };
  }

  function exportPng() {
    return displayCanvas.toDataURL("image/png");
  }

  function exportBasePng() {
    if (!scene) return null;
    const c = document.createElement("canvas");
    c.width = scene.working.w;
    c.height = scene.working.h;
    c.getContext("2d").putImageData(scene.working.imageData, 0, 0);
    return c.toDataURL("image/png");
  }

  function getImageScreenRect() {
    if (!scene || !lastOutput) return null;
    const rect = coverRect(scene.working.w, scene.working.h, width, height);
    const px = (viewMode === "scenescape" ? parallax.x * 36 + orbit.yaw * 40 : 0) + pan.x;
    const py = (viewMode === "scenescape" ? parallax.y * 22 + orbit.pitch * 28 : 0) + pan.y;
    const scaleBoost = (viewMode === "scenescape" ? 1.06 + Math.abs(orbit.yaw) * 0.02 : 1) * zoom;
    const map = (sx, sy) => {
      const dx = sx - width / 2;
      const dy = sy - height / 2;
      return {
        x: width / 2 + px + dx * scaleBoost,
        y: height / 2 + py + dy * scaleBoost,
      };
    };
    const tl = map(rect.x, rect.y);
    const br = map(rect.x + rect.w, rect.y + rect.h);
    return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
  }

  function exportWorkingPng() {
    if (!lastOutput || !scene) return null;
    const c = document.createElement("canvas");
    c.width = scene.working.w;
    c.height = scene.working.h;
    const ctx = c.getContext("2d");
    if (typeof LuminaCompose !== "undefined" && LuminaCompose.active()) {
      LuminaCompose.paintFrame(ctx, lastOutput, scene, { forExport: true });
    } else {
      ctx.putImageData(lastOutput, 0, 0);
    }
    return c.toDataURL("image/png");
  }

  function hasScene() {
    return !!scene;
  }

  return {
    init,
    setScene,
    getScene,
    getEntities,
    setEntities,
    evaluate,
    scheduleEvaluate,
    setViewMode,
    setParallax,
    setOrbit,
    setCompare,
    setRegionLock,
    setSoftProof,
    setStraightenPreview,
    getPaintMask,
    setZoom,
    zoomBy,
    zoomIn,
    zoomOut,
    zoomFit,
    zoomActual,
    setPan,
    panBy,
    getZoomState,
    setOnZoomChange,
    setOnSourceChange,
    getSourceImageData,
    commitSource,
    undoSource,
    canUndoSource,
    sourceEditCount,
    setPaintEntity,
    paintAt,
    clearPaint,
    getDefaultParams,
    setLastParams,
    lastParams,
    entityScreenBounds,
    sampleDepth,
    getImageScreenRect,
    exportPng,
    exportWorkingPng,
    exportBasePng,
    hasScene,
    present,
    cloneImageData,
  };
})();
