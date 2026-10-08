/**
 * Intelligent erase / object removal.
 *
 * Selection lives in a mask canvas held at working resolution: a brush, a box,
 * a magic-wand region grow, or the neural subject matte all write into the same
 * mask. Applying it hands the mask to LuminaInpaint, which rebuilds the covered
 * pixels from their surroundings, and commits the result as the new source the
 * Thought Graph evaluates from.
 */
const LuminaErase = (() => {
  const settings = {
    mode: "brush",
    brush: 34,
    grow: 3,
    tolerance: 26,
    quality: "balanced",
  };

  let active = false;
  let busy = false;
  let toast = () => {};
  let handlers = {};

  let layer = null;
  let overlay = null;
  let overlayCtx = null;
  let cursor = null;
  let marquee = null;
  let dock = null;

  /** White = selected. Alpha channel is the mask. */
  let maskCanvas = null;
  let maskCtx = null;
  let tintCanvas = null;
  let tintCtx = null;
  let hasSelection = false;

  let stroke = null;
  let box = null;

  function sceneSize() {
    const scene = LuminaEngine.getScene?.();
    return scene ? { w: scene.working.w, h: scene.working.h } : null;
  }

  function isActive() {
    return active;
  }

  /* —— DOM —— */

  function ensureUi() {
    if (!document.getElementById("eraseLayer")) {
      layer = document.createElement("div");
      layer.id = "eraseLayer";
      layer.className = "erase-layer";
      layer.hidden = true;
      layer.innerHTML = `
        <canvas class="erase-overlay" id="eraseOverlay"></canvas>
        <span class="erase-cursor" id="eraseCursor" hidden></span>
        <span class="erase-marquee" id="eraseMarquee" hidden></span>
      `;
      document.getElementById("canvasZone")?.appendChild(layer);
    } else {
      layer = document.getElementById("eraseLayer");
    }
    overlay = document.getElementById("eraseOverlay");
    overlayCtx = overlay.getContext("2d");
    cursor = document.getElementById("eraseCursor");
    marquee = document.getElementById("eraseMarquee");

    if (!document.getElementById("eraseDock")) {
      dock = document.createElement("aside");
      dock.id = "eraseDock";
      dock.className = "compose-dock erase-dock";
      dock.hidden = true;
      dock.innerHTML = `
        <header class="compose-head">
          <div>
            <strong>Erase</strong>
            <span>Select it, and it is gone</span>
          </div>
          <button type="button" class="icon-btn" id="btnEraseClose" aria-label="Close erase">×</button>
        </header>
        <section class="compose-section">
          <h3>Select what to remove</h3>
          <div class="compose-row erase-modes" role="group" aria-label="Selection mode">
            <button type="button" class="chrome-btn" data-erase-mode="brush">Brush</button>
            <button type="button" class="chrome-btn" data-erase-mode="box">Box</button>
            <button type="button" class="chrome-btn" data-erase-mode="object">Magic</button>
          </div>
          <p class="erase-hint" id="eraseHint"></p>
          <div class="compose-grid">
            <label class="compose-field">Brush size
              <input type="range" id="eraseBrush" min="4" max="180" step="1" value="34" />
            </label>
            <label class="compose-field">Edge margin
              <input type="range" id="eraseGrow" min="0" max="14" step="1" value="3" />
            </label>
          </div>
          <label class="compose-field" id="eraseTolField">Magic tolerance
            <input type="range" id="eraseTol" min="6" max="80" step="1" value="26" />
          </label>
          <div class="compose-row erase-entities" id="eraseEntities"></div>
          <div class="compose-row">
            <button type="button" class="chrome-btn" id="btnEraseSubject">Select subject (AI)</button>
            <button type="button" class="chrome-btn" id="btnEraseClear">Clear</button>
          </div>
        </section>
        <section class="compose-section">
          <h3>Fill</h3>
          <label class="compose-field">Quality
            <select id="eraseQuality"></select>
          </label>
          <p class="erase-status" id="eraseStatus">Nothing selected yet.</p>
          <div class="erase-progress" id="eraseProgress" hidden><i></i></div>
          <div class="compose-row">
            <button type="button" class="cta" id="btnEraseApply">Erase &amp; fill</button>
            <button type="button" class="chrome-btn" id="btnEraseUndo">Undo erase</button>
          </div>
        </section>
      `;
      document.getElementById("app")?.appendChild(dock);
    } else {
      dock = document.getElementById("eraseDock");
    }
  }

  function bindUi() {
    document.getElementById("btnEraseClose")?.addEventListener("click", () => close());
    dock.querySelectorAll("[data-erase-mode]").forEach((btn) => {
      btn.addEventListener("click", () => setMode(btn.dataset.eraseMode));
    });

    bindRange("eraseBrush", (v) => {
      settings.brush = v;
      updateCursorSize();
    });
    bindRange("eraseGrow", (v) => {
      settings.grow = v;
    });
    bindRange("eraseTol", (v) => {
      settings.tolerance = v;
    });

    const quality = document.getElementById("eraseQuality");
    if (quality) {
      quality.innerHTML = "";
      for (const q of LuminaInpaint.listQualities()) {
        const opt = document.createElement("option");
        opt.value = q.key;
        opt.textContent = q.label;
        quality.appendChild(opt);
      }
      quality.value = settings.quality;
      quality.addEventListener("change", () => {
        settings.quality = quality.value;
      });
    }

    document.getElementById("btnEraseClear")?.addEventListener("click", () => {
      clearSelection();
      setStatus("Selection cleared.");
    });
    document.getElementById("btnEraseSubject")?.addEventListener("click", () => selectSubject());
    document.getElementById("btnEraseApply")?.addEventListener("click", () => apply());
    document.getElementById("btnEraseUndo")?.addEventListener("click", () => undo());

    layer.addEventListener("pointerdown", onPointerDown);
    layer.addEventListener("pointermove", onPointerMove);
    layer.addEventListener("pointerup", onPointerUp);
    layer.addEventListener("pointercancel", onPointerUp);
    layer.addEventListener("pointerenter", () => {
      if (settings.mode === "brush") cursor.hidden = false;
    });
    layer.addEventListener("pointerleave", () => {
      cursor.hidden = true;
    });

    window.addEventListener("keydown", (e) => {
      if (!active) return;
      if (e.key === "Escape") {
        close();
        return;
      }
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "SELECT") return;
      if (e.key === "[" || e.key === "]") {
        const step = e.key === "[" ? -6 : 6;
        setBrush(settings.brush + step);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        apply();
      }
    });
  }

  function bindRange(id, fn) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => fn(Number(el.value)));
  }

  function setBrush(v) {
    settings.brush = Math.min(180, Math.max(4, Math.round(v)));
    const el = document.getElementById("eraseBrush");
    if (el) el.value = String(settings.brush);
    updateCursorSize();
  }

  const HINTS = {
    brush: "Paint over the object. Hold Alt to rub the selection back out.",
    box: "Drag a rectangle around the object. Hold Alt to subtract.",
    object: "Click an object or a detected region (person, sky). Alt-click subtracts.",
  };

  function setMode(mode) {
    settings.mode = mode;
    dock.querySelectorAll("[data-erase-mode]").forEach((b) => {
      b.classList.toggle("active", b.dataset.eraseMode === mode);
    });
    const hint = document.getElementById("eraseHint");
    if (hint) hint.textContent = HINTS[mode] || "";
    const tol = document.getElementById("eraseTolField");
    if (tol) tol.hidden = mode !== "object";
    cursor.hidden = mode !== "brush";
    layer.dataset.mode = mode;
  }

  function setStatus(text, state = "") {
    const el = document.getElementById("eraseStatus");
    if (!el) return;
    el.textContent = text;
    el.dataset.state = state;
  }

  function setProgress(pct) {
    const el = document.getElementById("eraseProgress");
    if (!el) return;
    if (pct == null) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.firstElementChild.style.width = `${Math.round(pct * 100)}%`;
  }

  /* —— mask buffers —— */

  function ensureMask() {
    const size = sceneSize();
    if (!size) return false;
    if (!maskCanvas || maskCanvas.width !== size.w || maskCanvas.height !== size.h) {
      maskCanvas = document.createElement("canvas");
      maskCanvas.width = size.w;
      maskCanvas.height = size.h;
      maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
      tintCanvas = document.createElement("canvas");
      tintCanvas.width = size.w;
      tintCanvas.height = size.h;
      tintCtx = tintCanvas.getContext("2d");
      overlay.width = size.w;
      overlay.height = size.h;
      hasSelection = false;
    }
    return true;
  }

  function clearSelection() {
    if (!maskCtx) return;
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    hasSelection = false;
    drawOverlay();
    updateApplyState();
  }

  function drawOverlay() {
    if (!overlayCtx || !maskCanvas) return;
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    if (!hasSelection) return;
    tintCtx.clearRect(0, 0, tintCanvas.width, tintCanvas.height);
    tintCtx.globalCompositeOperation = "source-over";
    tintCtx.drawImage(maskCanvas, 0, 0);
    tintCtx.globalCompositeOperation = "source-in";
    tintCtx.fillStyle = "rgba(255, 96, 96, 0.45)";
    tintCtx.fillRect(0, 0, tintCanvas.width, tintCanvas.height);
    tintCtx.globalCompositeOperation = "source-over";
    overlayCtx.drawImage(tintCanvas, 0, 0);
  }

  /** Keep the layer glued to wherever the image is drawn (zoom, pan, resize). */
  function syncOverlay() {
    if (!active || !layer) return;
    const rect = LuminaEngine.getImageScreenRect?.();
    if (!rect) {
      layer.hidden = true;
      return;
    }
    layer.hidden = false;
    layer.style.left = `${rect.x}px`;
    layer.style.top = `${rect.y}px`;
    layer.style.width = `${rect.w}px`;
    layer.style.height = `${rect.h}px`;
    updateCursorSize();
  }

  function screenScale() {
    const size = sceneSize();
    if (!size) return 1;
    const rect = layer.getBoundingClientRect();
    return rect.width ? rect.width / size.w : 1;
  }

  function updateCursorSize() {
    if (!cursor) return;
    const d = settings.brush * 2 * screenScale();
    cursor.style.width = `${d}px`;
    cursor.style.height = `${d}px`;
  }

  function toImage(e) {
    const size = sceneSize();
    if (!size) return null;
    const rect = layer.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * size.w,
      y: ((e.clientY - rect.top) / rect.height) * size.h,
      local: { x: e.clientX - rect.left, y: e.clientY - rect.top },
    };
  }

  /* —— pointer —— */

  function onPointerDown(e) {
    if (!active || busy || !ensureMask()) return;
    const p = toImage(e);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      layer.setPointerCapture(e.pointerId);
    } catch (_) {
      /* pointer already released */
    }

    if (settings.mode === "object") {
      if (trySelectEntityAt(Math.round(p.x), Math.round(p.y), e.altKey)) return;
      selectRegionAt(Math.round(p.x), Math.round(p.y), e.altKey);
      return;
    }
    if (settings.mode === "box") {
      box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, subtract: e.altKey, local0: p.local };
      marquee.hidden = false;
      drawMarquee(p.local, p.local);
      return;
    }
    stroke = { last: p, subtract: e.altKey };
    paintDab(p.x, p.y, p.x, p.y, e.altKey);
  }

  function onPointerMove(e) {
    if (!active) return;
    const p = toImage(e);
    if (!p) return;
    if (cursor && settings.mode === "brush") {
      cursor.hidden = false;
      cursor.style.left = `${p.local.x}px`;
      cursor.style.top = `${p.local.y}px`;
    }
    if (busy) return;

    if (stroke) {
      e.stopPropagation();
      paintDab(stroke.last.x, stroke.last.y, p.x, p.y, stroke.subtract);
      stroke.last = p;
      return;
    }
    if (box) {
      e.stopPropagation();
      box.x1 = p.x;
      box.y1 = p.y;
      drawMarquee(box.local0, p.local);
    }
  }

  function onPointerUp(e) {
    if (stroke) {
      stroke = null;
      updateApplyState();
    }
    if (box) {
      const x0 = Math.min(box.x0, box.x1);
      const y0 = Math.min(box.y0, box.y1);
      const w = Math.abs(box.x1 - box.x0);
      const h = Math.abs(box.y1 - box.y0);
      if (w > 2 && h > 2) {
        maskCtx.globalCompositeOperation = box.subtract ? "destination-out" : "source-over";
        maskCtx.fillStyle = "#fff";
        maskCtx.fillRect(x0, y0, w, h);
        maskCtx.globalCompositeOperation = "source-over";
        if (!box.subtract) hasSelection = true;
        drawOverlay();
      }
      box = null;
      marquee.hidden = true;
      updateApplyState();
    }
    try {
      if (layer.hasPointerCapture?.(e.pointerId)) layer.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* pointer already released */
    }
  }

  function drawMarquee(a, b) {
    marquee.style.left = `${Math.min(a.x, b.x)}px`;
    marquee.style.top = `${Math.min(a.y, b.y)}px`;
    marquee.style.width = `${Math.abs(b.x - a.x)}px`;
    marquee.style.height = `${Math.abs(b.y - a.y)}px`;
  }

  function paintDab(x0, y0, x1, y1, subtract) {
    maskCtx.globalCompositeOperation = subtract ? "destination-out" : "source-over";
    maskCtx.strokeStyle = "#fff";
    maskCtx.fillStyle = "#fff";
    maskCtx.lineCap = "round";
    maskCtx.lineJoin = "round";
    maskCtx.lineWidth = settings.brush * 2;
    maskCtx.beginPath();
    maskCtx.moveTo(x0, y0);
    maskCtx.lineTo(x1, y1);
    maskCtx.stroke();
    maskCtx.globalCompositeOperation = "source-over";
    if (!subtract) hasSelection = true;
    drawOverlay();
  }

  /* —— selection helpers —— */

  function refreshEntities() {
    const wrap = document.getElementById("eraseEntities");
    if (!wrap) return;
    wrap.innerHTML = "";
    const ents = LuminaEngine.getEntities?.() || [];
    for (const e of ents) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chrome-btn";
      btn.textContent = e.name;
      btn.title = `Select ${e.name} region`;
      btn.addEventListener("click", () => selectEntity(e.id));
      wrap.appendChild(btn);
    }
  }

  /**
   * People / eyes are compact regions — clicking them should take the reconstructed
   * entity, not a colour-grow that spills into clothes or the wall behind.
   */
  const CLICKABLE_ENTITIES = new Set(["skin", "eyes", "face"]);

  function trySelectEntityAt(px, py, subtract) {
    const size = sceneSize();
    if (!size || typeof LuminaSegment === "undefined") return false;
    const entity = LuminaSegment.hitTest(LuminaEngine.getEntities?.() || [], px / size.w, py / size.h);
    if (!entity || !CLICKABLE_ENTITIES.has(entity.id)) return false;
    return selectEntity(entity.id, subtract);
  }

  function selectEntity(id, subtract = false) {
    const scene = LuminaEngine.getScene?.();
    if (!scene || !ensureMask() || typeof LuminaReconstruct === "undefined") return false;
    const alpha = LuminaReconstruct.buildEntityMask(
      id,
      scene.materials,
      scene.depth,
      scene.working.w,
      scene.working.h,
      scene.faces
    );
    const flags = new Uint8Array(alpha.length);
    let count = 0;
    for (let i = 0; i < alpha.length; i++) {
      if (alpha[i] > 0.5) {
        flags[i] = 1;
        count++;
      }
    }
    if (!count) {
      setStatus(`No ${id} region found — try Magic or Brush.`, "fallback");
      return false;
    }
    writeMaskFromFlags(flags, subtract);
    setStatus(
      subtract ? `${id} removed from the selection.` : `Selected ${id}. Erase & fill to remove it.`
    );
    return true;
  }

  function writeMaskFromFlags(flags, subtract) {
    const size = sceneSize();
    const img = new ImageData(size.w, size.h);
    const d = img.data;
    for (let i = 0; i < flags.length; i++) {
      if (!flags[i]) continue;
      const o = i * 4;
      d[o] = 255;
      d[o + 1] = 255;
      d[o + 2] = 255;
      d[o + 3] = 255;
    }
    const tmp = document.createElement("canvas");
    tmp.width = size.w;
    tmp.height = size.h;
    tmp.getContext("2d").putImageData(img, 0, 0);
    maskCtx.globalCompositeOperation = subtract ? "destination-out" : "source-over";
    maskCtx.drawImage(tmp, 0, 0);
    maskCtx.globalCompositeOperation = "source-over";
    if (!subtract) hasSelection = true;
    drawOverlay();
    updateApplyState();
  }

  /**
   * Magic-wand grow: take everything connected to the click that stays within
   * `tolerance` of the seed colour, then close pinholes so the object comes out
   * solid rather than speckled.
   */
  function selectRegionAt(px, py, subtract) {
    const src = LuminaEngine.getSourceImageData();
    if (!src) return;
    const w = src.width;
    const h = src.height;
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    const data = src.data;

    let sr = 0;
    let sg = 0;
    let sb = 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = Math.min(w - 1, Math.max(0, px + dx));
        const y = Math.min(h - 1, Math.max(0, py + dy));
        const o = (y * w + x) * 4;
        sr += data[o];
        sg += data[o + 1];
        sb += data[o + 2];
        n++;
      }
    }
    sr /= n;
    sg /= n;
    sb /= n;

    const tolSq = settings.tolerance * settings.tolerance * 3;
    const maxArea = Math.floor(w * h * 0.65);
    const flags = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let qh = 0;
    let qt = 0;
    const start = py * w + px;
    flags[start] = 1;
    queue[qt++] = start;
    let area = 1;

    while (qh < qt && area < maxArea) {
      const i = queue[qh++];
      const x = i % w;
      const y = (i / w) | 0;
      const nbs = [];
      if (x > 0) nbs.push(i - 1);
      if (x + 1 < w) nbs.push(i + 1);
      if (y > 0) nbs.push(i - w);
      if (y + 1 < h) nbs.push(i + w);
      for (const j of nbs) {
        if (flags[j]) continue;
        const o = j * 4;
        const dr = data[o] - sr;
        const dg = data[o + 1] - sg;
        const db = data[o + 2] - sb;
        if (dr * dr + dg * dg + db * db > tolSq) continue;
        flags[j] = 1;
        queue[qt++] = j;
        area++;
      }
    }

    closeHoles(flags, w, h, 2);
    writeMaskFromFlags(flags, subtract);
    setStatus(
      subtract
        ? "Region removed from the selection."
        : `Grabbed ${Math.round((area / (w * h)) * 100)}% of the frame — brush to refine.`
    );
  }

  /** Neural subject matte — good for "remove the person / the product". */
  async function selectSubject() {
    if (busy) return;
    const src = LuminaEngine.getSourceImageData();
    if (!src || !ensureMask()) {
      toast("Open an image first");
      return;
    }
    if (typeof LuminaMatte === "undefined" || !LuminaMatte.isSupported()) {
      toast("Subject model unavailable — use Magic or Brush");
      return;
    }
    busy = true;
    updateApplyState();
    setStatus("Loading subject model…", "working");
    setProgress(0);
    try {
      const alpha = await LuminaMatte.run(src, "subject", (p) => {
        setProgress(p.pct || 0);
        setStatus(`${p.label}…`, "working");
      });
      const flags = new Uint8Array(alpha.length);
      let count = 0;
      for (let i = 0; i < alpha.length; i++) {
        if (alpha[i] > 0.5) {
          flags[i] = 1;
          count++;
        }
      }
      if (!count) {
        setStatus("No clear subject found — try Magic or Brush.", "fallback");
        return;
      }
      writeMaskFromFlags(flags, false);
      setStatus("Subject selected. Erase & fill to remove it.");
    } catch (err) {
      console.warn("[LuminaErase] subject selection failed:", err);
      setStatus("Subject model unavailable — use Magic or Brush.", "fallback");
    } finally {
      setProgress(null);
      busy = false;
      updateApplyState();
    }
  }

  /** Morphological close: fill speckles inside a freshly grown region. */
  function closeHoles(flags, w, h, radius) {
    const dil = morph(flags, w, h, radius, true);
    const ero = morph(dil, w, h, radius, false);
    flags.set(ero);
  }

  function morph(src, w, h, radius, dilate) {
    const tmp = new Uint8Array(src.length);
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = dilate ? 0 : 1;
        for (let k = -radius; k <= radius; k++) {
          const xx = Math.min(w - 1, Math.max(0, x + k));
          const s = src[y * w + xx];
          v = dilate ? v | s : v & s;
        }
        tmp[y * w + x] = v;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = dilate ? 0 : 1;
        for (let k = -radius; k <= radius; k++) {
          const yy = Math.min(h - 1, Math.max(0, y + k));
          const s = tmp[yy * w + x];
          v = dilate ? v | s : v & s;
        }
        out[y * w + x] = v;
      }
    }
    return out;
  }

  function readMask() {
    const size = sceneSize();
    if (!size || !maskCtx) return null;
    const data = maskCtx.getImageData(0, 0, size.w, size.h).data;
    const flags = new Uint8Array(size.w * size.h);
    let count = 0;
    for (let i = 0; i < flags.length; i++) {
      if (data[i * 4 + 3] > 127) {
        flags[i] = 1;
        count++;
      }
    }
    return count ? flags : null;
  }

  function updateApplyState() {
    const applyBtn = document.getElementById("btnEraseApply");
    if (applyBtn) applyBtn.disabled = busy;
    const undoBtn = document.getElementById("btnEraseUndo");
    if (undoBtn) undoBtn.disabled = busy || !LuminaEngine.canUndoSource?.();
    const subjectBtn = document.getElementById("btnEraseSubject");
    if (subjectBtn) subjectBtn.disabled = busy;
  }

  /* —— apply —— */

  async function apply() {
    if (busy) return;
    if (!LuminaEngine.hasScene()) {
      toast("Open an image first");
      return;
    }
    const size = sceneSize();
    let flags = readMask();
    if (!flags) {
      setStatus("Select something first — brush, box, or magic-click it.", "fallback");
      toast("Nothing selected to erase");
      return;
    }
    // A little margin past the selection hides the object's own soft edge and
    // any shadow fringe that would otherwise survive the fill.
    if (settings.grow > 0) flags = morph(flags, size.w, size.h, settings.grow, true);

    busy = true;
    updateApplyState();
    setStatus("Rebuilding the covered area…", "working");
    setProgress(0);
    const started = performance.now();

    try {
      const filled = await LuminaInpaint.fill(
        LuminaEngine.getSourceImageData(),
        flags,
        { quality: settings.quality },
        (p) => {
          setProgress(p.pct);
          if (p.label) setStatus(`${p.label}…`, "working");
        }
      );
      if (!filled) {
        setStatus("Nothing to fill.", "fallback");
        return;
      }
      LuminaEngine.commitSource(filled);
      clearSelection();
      handlers.onErase?.();
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      setStatus(`Filled in ${secs}s. Paint another area or close the panel.`, "ready");
      toast("Object removed — content-aware fill applied");
    } catch (err) {
      console.warn("[LuminaErase] fill failed:", err);
      setStatus(err?.message || "Fill failed.", "fallback");
      toast("Erase failed");
    } finally {
      setProgress(null);
      busy = false;
      updateApplyState();
    }
  }

  function undo() {
    if (busy) return;
    if (!LuminaEngine.undoSource?.()) {
      setStatus("No erase to undo.", "fallback");
      return;
    }
    handlers.onUndo?.();
    setStatus("Last erase reverted.");
    updateApplyState();
  }

  /* —— lifecycle —— */

  function open() {
    if (!LuminaEngine.hasScene()) {
      toast("Open an image first");
      return;
    }
    ensureMask();
    active = true;
    // Both docks are pinned to the same corner, so only one can be up at a time.
    if (typeof LuminaCompose !== "undefined") LuminaCompose.setDockOpen(false);
    dock.hidden = false;
    layer.hidden = false;
    document.getElementById("app")?.classList.add("erase-mode");
    setMode(settings.mode);
    refreshEntities();
    updateApplyState();
    if (!hasSelection) setStatus("Nothing selected yet.");
    syncOverlay();
    drawOverlay();
    handlers.onOpen?.();
  }

  function close() {
    active = false;
    if (dock) dock.hidden = true;
    if (layer) layer.hidden = true;
    document.getElementById("app")?.classList.remove("erase-mode");
    handlers.onClose?.();
  }

  function toggle() {
    if (active) close();
    else open();
  }

  function resetForScene() {
    hasSelection = false;
    if (maskCtx) maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    if (overlayCtx) overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  }

  function init(h = {}) {
    handlers = h;
    toast = h.toast || toast;
    ensureUi();
    bindUi();
    setMode(settings.mode);
  }

  return {
    init,
    open,
    close,
    toggle,
    isActive,
    syncOverlay,
    resetForScene,
    apply,
    undo,
    clearSelection,
    selectSubject,
    selectEntity,
    getSettings: () => ({ ...settings }),
    setSettings: (patch) => Object.assign(settings, patch),
  };
})();
