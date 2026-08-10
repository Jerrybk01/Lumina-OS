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
  let width = 0;
  let height = 0;
  let dpr = 1;
  let lastOutput = null;
  let baseOutput = null;

  function init(sceneEl, overlayEl) {
    displayCanvas = sceneEl;
    overlayCanvas = overlayEl;
    displayCtx = displayCanvas.getContext("2d");
    overlayCtx = overlayCanvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
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
    paintMask = new Float32Array(w * h);
    baseOutput = cloneImageData(next.working.imageData);
    lastOutput = cloneImageData(next.working.imageData);
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

  function setCompare(on, split = 0.5) {
    compareMode = on;
    compareSplit = split;
    present();
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

    const parentsOf = {};
    for (const n of nodes) parentsOf[n.id] = [];
    for (const e of edges) {
      if (parentsOf[e.to]) parentsOf[e.to].push(e.from);
    }

    const buffers = new Map();
    const order = topoSort(nodes, edges);
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
        case "blend":
          output = applyBlend(buffers, parents, node, w, h, scene);
          break;
        case "branch":
          output = input;
          break;
        case "intent":
        default:
          output = applyAtmosphere(applyRelight(input, w, h, p, scene), w, h, p, scene, 0.4);
          break;
      }

      // Node-local entity refinements from HUD params stored on node
      if (node.meta?.entityId) {
        output = applyEntityPolish(output, w, h, p, scene, node.meta.entityId);
      }

      buffers.set(node.id, output);
    }

    const targetId = options.targetId || order[order.length - 1]?.id;
    lastOutput = buffers.get(targetId) || cloneImageData(scene.working.imageData);
    baseOutput = buffers.get(nodes.find((n) => n.type === "ingest")?.id) || cloneImageData(scene.working.imageData);
    present();
    return lastOutput;
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
    const out = cloneImageData(imageData);
    const d = out.data;
    const cool = p.coolShift || (1 - p.goldenHour) * p.atmosphericHaze * 0.5;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp255(d[i] * (1 - cool * 0.15));
      d[i + 2] = clamp255(d[i + 2] * (1 + cool * 0.2));
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
    tctx.putImageData(lastOutput, 0, 0);

    const rect = coverRect(tmp.width, tmp.height, width, height);
    const px = viewMode === "scenescape" ? parallax.x * 36 + orbit.yaw * 40 : 0;
    const py = viewMode === "scenescape" ? parallax.y * 22 + orbit.pitch * 28 : 0;
    const scaleBoost = viewMode === "scenescape" ? 1.06 + Math.abs(orbit.yaw) * 0.02 : 1;

    displayCtx.save();
    displayCtx.translate(width / 2 + px, height / 2 + py);
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
      tctx.putImageData(lastOutput, 0, 0);
      displayCtx.drawImage(tmp, rect.x, rect.y, rect.w, rect.h);
      displayCtx.restore();

      displayCtx.fillStyle = "rgba(236,240,244,0.85)";
      displayCtx.fillRect(splitX - 1, 0, 2, height);
    } else {
      tctx.putImageData(lastOutput, 0, 0);
      displayCtx.drawImage(tmp, rect.x, rect.y, rect.w, rect.h);

      // Depth-based layered parallax strips in scenescape
      if (viewMode === "scenescape") {
        drawDepthLayers(displayCtx, tmp, rect);
      }
    }
    displayCtx.restore();

    if (viewMode === "scenescape") drawScenescapeOverlay();
  }

  function drawDepthLayers(ctx, srcCanvas, rect) {
    // Additional far/near shifts for volumetric feel
    const off = document.createElement("canvas");
    off.width = srcCanvas.width;
    off.height = srcCanvas.height;
    const ox = off.getContext("2d");
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

  function exportWorkingPng() {
    if (!lastOutput || !scene) return null;
    const c = document.createElement("canvas");
    c.width = scene.working.w;
    c.height = scene.working.h;
    c.getContext("2d").putImageData(lastOutput, 0, 0);
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
    setViewMode,
    setParallax,
    setOrbit,
    setCompare,
    setPaintEntity,
    paintAt,
    clearPaint,
    getDefaultParams,
    setLastParams,
    lastParams,
    entityScreenBounds,
    sampleDepth,
    exportPng,
    exportWorkingPng,
    exportBasePng,
    hasScene,
    present,
    cloneImageData,
  };
})();
