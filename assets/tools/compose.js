/**
 * Compose UI: background remove/replace (via LuminaBg) + responsive text boxes.
 */
const LuminaCompose = (() => {
  let bg = { mode: "original", color: "#00c853", gradient: "sunset", image: null, shadow: 0, reflect: 0, rim: 0 };
  let texts = [];
  let selectedId = null;
  let dock = null;
  let textLayer = null;
  let bgInput = null;
  let toast = () => {};
  let dragState = null;

  function init(handlers = {}) {
    toast = handlers.toast || toast;
    ensureUi();
    bindUi();
  }

  function ensureUi() {
    if (!document.getElementById("composeDock")) {
      dock = document.createElement("aside");
      dock.id = "composeDock";
      dock.className = "compose-dock";
      dock.hidden = true;
      dock.innerHTML = `
        <header class="compose-head">
          <div>
            <strong>Compose</strong>
            <span>Background &amp; text</span>
          </div>
          <button type="button" class="icon-btn" id="btnComposeClose" aria-label="Close">×</button>
        </header>
        <section class="compose-section">
          <h3>Background</h3>
          <div class="compose-row">
            <button type="button" class="chrome-btn" data-bg="transparent">Transparent</button>
            <button type="button" class="chrome-btn" data-bg="studio">Studio</button>
            <button type="button" class="chrome-btn" data-bg="solid">Color</button>
            <button type="button" class="chrome-btn" data-bg="gradient">Gradient</button>
            <button type="button" class="chrome-btn" data-bg="blur">Blur BG</button>
            <button type="button" class="chrome-btn" data-bg="image">Image…</button>
            <button type="button" class="chrome-btn" data-bg="original">Reset BG</button>
          </div>
          <label class="compose-field">Fill color
            <input type="color" id="bgColorPick" value="#00c853" />
          </label>
          <label class="compose-field">Gradient
            <select id="bgGradientPick">
              <option value="sunset">Sunset</option>
              <option value="studio">Studio</option>
              <option value="sky">Sky</option>
              <option value="forest">Forest</option>
              <option value="neon">Neon</option>
            </select>
          </label>
        </section>
        <section class="compose-section">
          <h3>Cutout</h3>
          <label class="compose-field">Subject detection
            <select id="matteEngine"></select>
          </label>
          <p class="matte-status" id="matteStatus">Pick a background to build the cutout.</p>
          <div class="compose-grid">
            <label class="compose-field">Edge feather
              <input type="range" id="matteFeather" min="0" max="4" step="1" value="1" />
            </label>
            <label class="compose-field">Edge shift
              <input type="range" id="matteShift" min="-3" max="3" step="1" value="0" />
            </label>
          </div>
          <label class="compose-check">
            <input type="checkbox" id="matteDecon" checked />
            Remove background colour spill
          </label>
        </section>
        <section class="compose-section">
          <h3>Stage</h3>
          <p class="compose-hint">Shadow follows the Light widget — drag the sun to move it.</p>
          <div class="compose-grid">
            <label class="compose-field">Drop shadow
              <input type="range" id="stageShadow" min="0" max="100" step="1" value="0" />
            </label>
            <label class="compose-field">Floor reflection
              <input type="range" id="stageReflect" min="0" max="100" step="1" value="0" />
            </label>
            <label class="compose-field">Rim light
              <input type="range" id="stageRim" min="0" max="100" step="1" value="0" />
            </label>
          </div>
        </section>
        <section class="compose-section">
          <h3>Text</h3>
          <div class="compose-row">
            <button type="button" class="chrome-btn" id="btnAddText">Add text box</button>
            <button type="button" class="chrome-btn" id="btnDeleteText">Delete</button>
          </div>
          <label class="compose-check">
            <input type="checkbox" id="textResponsive" checked />
            Responsive — wrap and scale with the box
          </label>
          <label class="compose-field">Content
            <textarea id="textContent" rows="2" placeholder="Type here…"></textarea>
          </label>
          <div class="compose-grid">
            <label class="compose-field">Size
              <input type="range" id="textSize" min="15" max="70" step="1" value="42" />
            </label>
            <label class="compose-field">Color
              <input type="color" id="textColor" value="#ffffff" />
            </label>
            <label class="compose-field">Align
              <select id="textAlign">
                <option value="left">Left</option>
                <option value="center" selected>Center</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label class="compose-field">Weight
              <select id="textWeight">
                <option value="500">Medium</option>
                <option value="700" selected>Bold</option>
                <option value="400">Regular</option>
              </select>
            </label>
          </div>
        </section>
      `;
      document.getElementById("app")?.appendChild(dock);
    } else {
      dock = document.getElementById("composeDock");
    }

    if (!document.getElementById("textLayer")) {
      textLayer = document.createElement("div");
      textLayer.id = "textLayer";
      textLayer.className = "text-layer";
      textLayer.hidden = true;
      document.getElementById("canvasZone")?.appendChild(textLayer);
    } else {
      textLayer = document.getElementById("textLayer");
    }

    if (!document.getElementById("bgReplaceInput")) {
      bgInput = document.createElement("input");
      bgInput.id = "bgReplaceInput";
      bgInput.className = "sr-only";
      bgInput.type = "file";
      bgInput.accept = "image/*";
      document.body.appendChild(bgInput);
    } else {
      bgInput = document.getElementById("bgReplaceInput");
    }
  }

  function bindUi() {
    document.getElementById("btnComposeClose")?.addEventListener("click", () => setDockOpen(false));
    dock?.querySelectorAll("[data-bg]").forEach((btn) => {
      btn.addEventListener("click", () => applyBgMode(btn.getAttribute("data-bg")));
    });
    document.getElementById("bgColorPick")?.addEventListener("input", (e) => {
      bg.color = e.target.value;
      if (bg.mode === "solid") refresh();
    });
    document.getElementById("bgGradientPick")?.addEventListener("change", (e) => {
      bg.gradient = e.target.value;
      if (bg.mode === "gradient") refresh();
    });
    bindMatteUi();
    bindStageUi();
    document.getElementById("btnAddText")?.addEventListener("click", () => addTextBox());
    document.getElementById("btnDeleteText")?.addEventListener("click", () => deleteSelected());
    document.getElementById("textContent")?.addEventListener("input", (e) => {
      const t = getSelected();
      if (!t) return;
      t.text = e.target.value;
      renderTextBoxes();
    });
    ["textSize", "textColor", "textAlign", "textWeight"].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", syncSelectedFromForm);
      document.getElementById(id)?.addEventListener("change", syncSelectedFromForm);
    });
    document.getElementById("textResponsive")?.addEventListener("change", (e) => {
      const t = getSelected();
      if (!t) return;
      const next = !!e.target.checked;
      if (next === (t.responsive !== false)) {
        t.responsive = next;
        renderTextBoxes();
        refresh();
        return;
      }
      if (next) {
        t.fontSize = clamp(t.h > 0.001 ? t.fontSize / t.h : 0.42, 0.15, 0.7);
      } else {
        t.fontSize = clamp(t.fontSize * t.h, 0.02, 0.18);
      }
      t.responsive = next;
      fillFormFromSelected();
      renderTextBoxes();
      refresh();
    });
    bgInput?.addEventListener("change", async () => {
      const file = bgInput.files?.[0];
      bgInput.value = "";
      if (!file) return;
      try {
        bg.image = await loadImage(file);
        bg.mode = "image";
        setDockOpen(true);
        rebuildMatte();
        refresh();
        syncBgButtons();
        toast("Background image applied");
      } catch {
        toast("Could not load background image");
      }
    });
  }

  function bindMatteUi() {
    if (typeof LuminaBg === "undefined") return;
    const engineSel = document.getElementById("matteEngine");
    const current = LuminaBg.getSettings();

    if (engineSel && typeof LuminaMatte !== "undefined") {
      engineSel.innerHTML = "";
      for (const m of LuminaMatte.listModels()) {
        const opt = document.createElement("option");
        opt.value = m.key;
        opt.textContent = `${m.label} — ${m.note}`;
        engineSel.appendChild(opt);
      }
      engineSel.value = current.engine;
      engineSel.addEventListener("change", () => {
        LuminaBg.setSettings({ engine: engineSel.value });
        rebuildMatte();
      });
    }

    const feather = document.getElementById("matteFeather");
    if (feather) {
      feather.value = String(current.feather);
      feather.addEventListener("input", () => {
        LuminaBg.setSettings({ feather: Number(feather.value) });
        refresh();
      });
    }

    const shift = document.getElementById("matteShift");
    if (shift) {
      shift.value = String(current.shift);
      shift.addEventListener("input", () => {
        LuminaBg.setSettings({ shift: Number(shift.value) });
        refresh();
      });
    }

    const decon = document.getElementById("matteDecon");
    if (decon) {
      decon.checked = current.decontaminate;
      decon.addEventListener("change", () => {
        LuminaBg.setSettings({ decontaminate: decon.checked });
        refresh();
      });
    }

    LuminaBg.onStatus(renderMatteStatus);
  }

  function bindStageUi() {
    const map = [
      ["stageShadow", "shadow"],
      ["stageReflect", "reflect"],
      ["stageRim", "rim"],
    ];
    for (const [id, key] of map) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener("input", () => {
        if (bg.mode === "original") applyBgMode("studio");
        bg[key] = Number(el.value) / 100;
        refresh();
      });
    }
  }

  function syncStageSliders() {
    const shadow = document.getElementById("stageShadow");
    const reflect = document.getElementById("stageReflect");
    const rim = document.getElementById("stageRim");
    if (shadow) shadow.value = String(Math.round((bg.shadow || 0) * 100));
    if (reflect) reflect.value = String(Math.round((bg.reflect || 0) * 100));
    if (rim) rim.value = String(Math.round((bg.rim || 0) * 100));
  }

  function renderMatteStatus(status) {
    const el = document.getElementById("matteStatus");
    if (!el) return;
    el.dataset.state = status.state;
    if (status.state === "working") {
      const pct = Math.round((status.pct || 0) * 100);
      el.textContent = pct > 0 && pct < 100 ? `${status.label}… ${pct}%` : `${status.label}…`;
    } else if (status.state === "ready") {
      el.textContent = "Neural cutout ready";
    } else if (status.state === "fallback") {
      el.textContent = status.label || "Using offline heuristic cutout";
    } else {
      el.textContent = "Pick a background to build the cutout.";
    }
  }

  /** Recompute the matte for the current scene and repaint when it lands. */
  function rebuildMatte() {
    if (typeof LuminaBg === "undefined") return Promise.resolve();
    const scene = LuminaEngine.getScene?.();
    if (!scene || !hasBgEffect()) return Promise.resolve();
    refresh();
    return LuminaBg.prepare(scene).then(() => refresh());
  }

  function isResponsive(t) {
    return !t || t.responsive !== false;
  }

  function syncSelectedFromForm() {
    const t = getSelected();
    if (!t) return;
    const raw = Number(document.getElementById("textSize")?.value || (isResponsive(t) ? 42 : 6));
    t.fontSize = raw / 100;
    t.color = document.getElementById("textColor")?.value || "#ffffff";
    t.align = document.getElementById("textAlign")?.value || "center";
    t.weight = document.getElementById("textWeight")?.value || "700";
    renderTextBoxes();
    refresh();
  }

  function configureSizeSlider(t) {
    const size = document.getElementById("textSize");
    if (!size) return;
    if (isResponsive(t)) {
      size.min = "15";
      size.max = "70";
      size.step = "1";
      size.value = String(Math.round(clamp(t?.fontSize ?? 0.42, 0.15, 0.7) * 100));
    } else {
      size.min = "2";
      size.max = "18";
      size.step = "0.5";
      size.value = String(Math.round((t?.fontSize ?? 0.06) * 1000) / 10);
    }
  }

  function fillFormFromSelected() {
    const t = getSelected();
    const content = document.getElementById("textContent");
    const responsive = document.getElementById("textResponsive");
    if (!t) {
      if (content) content.value = "";
      if (responsive) responsive.checked = true;
      configureSizeSlider({ responsive: true, fontSize: 0.42 });
      return;
    }
    if (content) content.value = t.text;
    if (responsive) responsive.checked = isResponsive(t);
    configureSizeSlider(t);
    const color = document.getElementById("textColor");
    if (color) color.value = t.color;
    const align = document.getElementById("textAlign");
    if (align) align.value = t.align;
    const weight = document.getElementById("textWeight");
    if (weight) weight.value = t.weight;
  }

  function setDockOpen(open) {
    if (!dock) return;
    dock.hidden = !open;
    if (textLayer) textLayer.hidden = !open && !texts.length ? true : false;
    if (open && texts.length) {
      textLayer.hidden = false;
      syncTextLayer();
    }
  }

  function openPanel() {
    setDockOpen(true);
    if (texts.length) {
      textLayer.hidden = false;
      syncTextLayer();
    }
  }

  function hasBgEffect() {
    return bg.mode !== "original";
  }

  function hasTexts() {
    return texts.length > 0;
  }

  function active() {
    return hasBgEffect() || hasTexts();
  }

  function refresh() {
    if (typeof LuminaEngine !== "undefined") LuminaEngine.present();
  }

  function resetForScene(scene) {
    if (typeof LuminaBg !== "undefined") LuminaBg.invalidate();
    bg = { mode: "original", color: bg.color || "#00c853", gradient: bg.gradient || "sunset", image: null, shadow: 0, reflect: 0, rim: 0 };
    texts = [];
    selectedId = null;
    if (textLayer) {
      textLayer.innerHTML = "";
      textLayer.hidden = true;
    }
    syncStageSliders();
    syncBgButtons();
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("load failed"));
      };
      img.src = url;
    });
  }

  function applyBgMode(mode) {
    if (!LuminaEngine.hasScene()) {
      toast("Open an image first");
      return;
    }
    if (mode === "image") {
      bgInput?.click();
      return;
    }
    if (mode === "solid") {
      bg.color = document.getElementById("bgColorPick")?.value || bg.color;
    }
    if (mode === "gradient") {
      bg.gradient = document.getElementById("bgGradientPick")?.value || bg.gradient;
    }
    if (mode === "studio") {
      if ((bg.shadow || 0) < 0.05) bg.shadow = 0.72;
      if ((bg.reflect || 0) < 0.05) bg.reflect = 0.22;
      if ((bg.rim || 0) < 0.05) bg.rim = 0.4;
      revealLight();
    }
    if (mode === "original") {
      bg.shadow = 0;
      bg.reflect = 0;
      bg.rim = 0;
    }
    bg.mode = mode;
    setDockOpen(true);
    rebuildMatte();
    refresh();
    syncStageSliders();
    syncBgButtons();
    const labels = {
      transparent: "Transparent background — checker preview · Export PNG keeps alpha",
      studio: "Studio drop — shadow follows Light · drag the sun",
      solid: "Solid background",
      gradient: "Gradient background",
      blur: "Blurred background",
      original: "Original background restored",
    };
    toast(labels[mode] || "Background updated");
  }

  function revealLight() {
    const pad = document.getElementById("lightWidget");
    if (pad) pad.hidden = false;
  }

  function syncBgButtons() {
    dock?.querySelectorAll("[data-bg]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-bg") === bg.mode);
    });
    document.getElementById("btnTransparent")?.classList.toggle("active", bg.mode === "transparent");
    document.getElementById("btnStudio")?.classList.toggle("active", bg.mode === "studio");
  }

  function getBg() {
    return { ...bg };
  }

  function isTransparent() {
    return bg.mode === "transparent";
  }

  function isStudio() {
    return bg.mode === "studio";
  }

  function toggleTransparent() {
    applyBgMode(bg.mode === "transparent" ? "original" : "transparent");
  }

  function toggleStudio() {
    applyBgMode(bg.mode === "studio" ? "original" : "studio");
  }

  /** Composite via LuminaBg; bake text only on export. */
  function paintFrame(ctx, sourceImageData, scene, { forExport = false } = {}) {
    const w = scene.working.w;
    const h = scene.working.h;
    if (typeof LuminaBg !== "undefined") {
      LuminaBg.composite(ctx, sourceImageData, scene, bg, { forExport });
    } else {
      ctx.putImageData(sourceImageData, 0, 0);
    }
    if (forExport) paintTexts(ctx, w, h);
  }

  function paintTexts(ctx, w, h) {
    for (const t of texts) {
      const x = t.x * w;
      const y = t.y * h;
      const boxW = t.w * w;
      const boxH = t.h * h;
      const fontPx = Math.max(
        8,
        isResponsive(t) ? t.fontSize * boxH : t.fontSize * h
      );
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, boxW, boxH);
      ctx.clip();
      ctx.font = `${t.weight} ${fontPx}px "Sora", "Figtree", system-ui, sans-serif`;
      ctx.fillStyle = t.color;
      ctx.textAlign = t.align;
      ctx.textBaseline = "top";
      const tx =
        t.align === "center" ? x + boxW / 2 : t.align === "right" ? x + boxW : x;
      wrapFillText(ctx, t.text || "", tx, y + boxH * 0.08, boxW * 0.92, fontPx * 1.25);
      ctx.restore();
    }
  }

  function wrapFillText(ctx, text, x, y, maxWidth, lineHeight) {
    const paragraphs = String(text).split(/\n/);
    let cy = y;
    for (const para of paragraphs) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) {
        cy += lineHeight;
        continue;
      }
      let line = words[0];
      for (let i = 1; i < words.length; i++) {
        const test = `${line} ${words[i]}`;
        if (ctx.measureText(test).width > maxWidth) {
          ctx.fillText(line, x, cy);
          cy += lineHeight;
          line = words[i];
        } else {
          line = test;
        }
      }
      ctx.fillText(line, x, cy);
      cy += lineHeight;
    }
  }

  function addTextBox(seed = {}) {
    if (!LuminaEngine.hasScene()) {
      toast("Open an image first");
      return;
    }
    const id = `t_${Date.now().toString(36)}`;
    const box = {
      id,
      text: seed.text || "Type here",
      x: seed.x ?? 0.18,
      y: seed.y ?? 0.68,
      w: seed.w ?? 0.64,
      h: seed.h ?? 0.18,
      fontSize: seed.fontSize ?? 0.42,
      responsive: seed.responsive !== false,
      color: seed.color || "#ffffff",
      align: seed.align || "center",
      weight: seed.weight || "700",
    };
    texts.push(box);
    selectedId = id;
    setDockOpen(true);
    textLayer.hidden = false;
    fillFormFromSelected();
    renderTextBoxes();
    syncTextLayer();
    refresh();
    document.getElementById("btnText")?.classList.add("active");
    toast("Text box — type, drag, resize; text wraps and scales");
  }

  function deleteSelected() {
    if (!selectedId) {
      toast("Select a text box first");
      return;
    }
    texts = texts.filter((t) => t.id !== selectedId);
    selectedId = texts[0]?.id || null;
    fillFormFromSelected();
    renderTextBoxes();
    if (!texts.length && textLayer) textLayer.hidden = dock?.hidden !== false;
    document.getElementById("btnText")?.classList.toggle("active", texts.length > 0);
    refresh();
  }

  function getSelected() {
    return texts.find((t) => t.id === selectedId) || null;
  }

  function renderTextBoxes() {
    if (!textLayer) return;
    textLayer.innerHTML = "";
    for (const t of texts) {
      const el = document.createElement("div");
      el.className = "text-box" + (t.id === selectedId ? " selected" : "");
      el.dataset.id = t.id;
      el.dataset.responsive = isResponsive(t) ? "true" : "false";
      el.style.left = `${t.x * 100}%`;
      el.style.top = `${t.y * 100}%`;
      el.style.width = `${t.w * 100}%`;
      el.style.height = `${t.h * 100}%`;
      el.style.setProperty("--text-rel", String(t.fontSize));

      const content = document.createElement("div");
      content.className = "text-box-content";
      content.contentEditable = "true";
      content.spellcheck = false;
      content.style.color = t.color;
      content.style.textAlign = t.align;
      content.style.fontWeight = t.weight;
      content.textContent = t.text;

      content.addEventListener("focus", () => {
        selectedId = t.id;
        textLayer.querySelectorAll(".text-box").forEach((n) => {
          n.classList.toggle("selected", n.dataset.id === t.id);
        });
        fillFormFromSelected();
      });
      content.addEventListener("input", () => {
        t.text = content.innerText;
        const form = document.getElementById("textContent");
        if (form && selectedId === t.id) form.value = t.text;
      });
      content.addEventListener("blur", () => refresh());

      el.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".text-box-handle")) return;
        selectedId = t.id;
        textLayer.querySelectorAll(".text-box").forEach((n) => {
          n.classList.toggle("selected", n.dataset.id === t.id);
        });
        fillFormFromSelected();
        if (e.detail > 1) return;
        e.preventDefault();
        const layer = textLayer.getBoundingClientRect();
        dragState = {
          type: "move",
          id: t.id,
          ox: e.clientX,
          oy: e.clientY,
          sx: t.x,
          sy: t.y,
          lw: layer.width,
          lh: layer.height,
        };
        window.addEventListener("pointermove", onDragMove);
        window.addEventListener("pointerup", onDragUp, { once: true });
      });

      const handle = document.createElement("span");
      handle.className = "text-box-handle";
      handle.title = "Resize";
      handle.addEventListener("pointerdown", (e) => onResizePointerDown(e, t));

      el.appendChild(content);
      el.appendChild(handle);
      textLayer.appendChild(el);
    }
  }

  function onResizePointerDown(e, t) {
    e.preventDefault();
    e.stopPropagation();
    selectedId = t.id;
    const layer = textLayer.getBoundingClientRect();
    dragState = {
      type: "resize",
      id: t.id,
      ox: e.clientX,
      oy: e.clientY,
      sw: t.w,
      sh: t.h,
      lw: layer.width,
      lh: layer.height,
    };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragUp, { once: true });
  }

  function onDragMove(e) {
    if (!dragState) return;
    const t = texts.find((x) => x.id === dragState.id);
    if (!t) return;
    const dx = (e.clientX - dragState.ox) / dragState.lw;
    const dy = (e.clientY - dragState.oy) / dragState.lh;
    if (dragState.type === "move") {
      t.x = clamp(dragState.sx + dx, 0, 1 - t.w);
      t.y = clamp(dragState.sy + dy, 0, 1 - t.h);
    } else {
      t.w = clamp(dragState.sw + dx, 0.12, 1 - t.x);
      t.h = clamp(dragState.sh + dy, 0.06, 1 - t.y);
    }
    const el = textLayer.querySelector(`[data-id="${t.id}"]`);
    if (el) {
      el.style.left = `${t.x * 100}%`;
      el.style.top = `${t.y * 100}%`;
      el.style.width = `${t.w * 100}%`;
      el.style.height = `${t.h * 100}%`;
    }
  }

  function onDragUp() {
    dragState = null;
    window.removeEventListener("pointermove", onDragMove);
    refresh();
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function syncTextLayer() {
    if (!textLayer || !texts.length) {
      if (textLayer && !texts.length) textLayer.hidden = true;
      return;
    }
    const rect = LuminaEngine.getImageScreenRect?.();
    if (!rect) {
      textLayer.hidden = true;
      return;
    }
    textLayer.hidden = false;
    textLayer.style.left = `${rect.x}px`;
    textLayer.style.top = `${rect.y}px`;
    textLayer.style.width = `${rect.w}px`;
    textLayer.style.height = `${rect.h}px`;
    textLayer.style.setProperty("--text-layer-h", `${rect.h}px`);
    if (!textLayer.childElementCount) renderTextBoxes();
  }

  function serialize() {
    return {
      bg: {
        mode: bg.mode,
        color: bg.color,
        gradient: bg.gradient,
        shadow: bg.shadow,
        reflect: bg.reflect,
        rim: bg.rim,
        // image not persisted as binary in this pass
      },
      texts: texts.map((t) => ({ ...t })),
    };
  }

  return {
    init,
    openPanel,
    setDockOpen,
    applyBgMode,
    toggleTransparent,
    toggleStudio,
    getBg,
    isTransparent,
    isStudio,
    addTextBox,
    hasBgEffect,
    hasTexts,
    active,
    paintFrame,
    syncTextLayer,
    resetForScene,
    serialize,
  };
})();
