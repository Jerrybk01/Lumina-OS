/**
 * Lumina Studio — presets, recipes, compare, crop, light widget, batch, tutorial.
 * light widget, batch, metadata, tutorial, plugins, materials, soft-proof.
 */
const LuminaStudio = (() => {
  const PRESETS = [
    { id: "natural", label: "Natural", params: { exposure: 0.05, contrast: 0.08, vibrance: 0.12, clarity: 0.08 } },
    { id: "vivid", label: "Vivid", params: { contrast: 0.22, vibrance: 0.4, saturation: 0.15, clarity: 0.2 } },
    { id: "film", label: "Film Fade", params: { fade: 0.35, grain: 0.3, contrast: 0.08, saturation: -0.05, vignette: 0.25 } },
    { id: "portrait", label: "Portrait Soft", params: { exposure: 0.08, shadows: 0.25, temperature: 0.12, clarity: -0.15, noiseReduce: 0.25 } },
    { id: "landscape", label: "Landscape", params: { dehaze: 0.35, clarity: 0.3, vibrance: 0.25, contrast: 0.15, highlights: -0.15 } },
    { id: "bw", label: "B&W Classic", params: { bw: 1, contrast: 0.2, grain: 0.2, vignette: 0.3 } },
    { id: "golden", label: "Golden Hour", params: { temperature: 0.4, goldenHour: 0.7, shadows: 0.2, vibrance: 0.15 } },
    { id: "cinematic", label: "Cinematic", params: { contrast: 0.25, fade: 0.2, temperature: 0.12, tint: -0.08, vignette: 0.35, saturation: -0.08 } },
    { id: "matte", label: "Matte", params: { fade: 0.4, blacks: -0.15, contrast: 0.1, saturation: -0.1 } },
    { id: "noir", label: "Noir", params: { bw: 1, contrast: 0.45, vignette: 0.55, grain: 0.35, exposure: -0.1 } },
  ];

  const RECIPES = [
    { label: "Golden hour sky", intent: "Make the reconstructed sky golden hour" },
    { label: "Recover highlights", intent: "Reconstruct sky detail from scattering" },
    { label: "Lift shadows", intent: "Lift the shadows gently" },
    { label: "Warm portrait", intent: "Warm skin and soft catchlight" },
    { label: "Select sky", intent: "select sky" },
    { label: "Erase objects", intent: "erase object" },
    { label: "Transparent BG", intent: "transparent background" },
    { label: "Studio drop", intent: "studio drop" },
    { label: "Select mountains", intent: "select mountains" },
    { label: "Cinematic grade", intent: "Apply a cinematic teal orange grade" },
    { label: "Dehaze landscape", intent: "Dehaze the distant atmosphere" },
  ];

  const MATERIALS = [
    { id: "sky-clear", label: "Clear Sky", type: "atmosphere", params: { refractiveHaze: 0.15, cloudDensity: 0.2, atmosphericHaze: 0.2 } },
    { id: "sky-storm", label: "Storm Sky", type: "atmosphere", params: { refractiveHaze: 0.45, cloudDensity: 0.8, coolShift: 0.4 } },
    { id: "sky-sunset", label: "Sunset Sky", type: "atmosphere", params: { goldenHour: 0.85, refractiveHaze: 0.3, cloudDensity: 0.5 } },
    { id: "rock-dry", label: "Dry Rock", type: "relight", params: { bounceReflectance: 0.55, surfaceTexture: 0.7, goldenHour: 0.2 } },
    { id: "rock-wet", label: "Wet Rock", type: "relight", params: { bounceReflectance: 0.75, surfaceTexture: 0.35, contrast: 0.1 } },
    { id: "foliage", label: "Foliage Soft", type: "adjust", params: { vibrance: 0.25, saturation: 0.1, clarity: 0.15, nearHaze: 0.2 } },
    { id: "skin-soft", label: "Skin Soft", type: "portrait", params: { sssDepth: 0.55, surfaceTexture: -0.15, noiseReduce: 0.3, catchlight: 0.45 } },
    { id: "eye-spark", label: "Eye Spark", type: "portrait", params: { irisReflectance: 0.7, catchlight: 0.75 } },
  ];

  const COMPARE_MODES = ["off", "swipe", "split", "blink"];

  let root;
  let opts = {};
  let compareMode = "off";
  let blinkTimer = null;
  let cropMode = false;
  let cropDraft = null;
  let regionLock = false;
  let softProof = false;
  let keepExif = true;
  let plugins = [];
  let tutorialDone = localStorage.getItem("lumina-tutorial-v1") === "1";
  let sceneReady = false;
  let userClosedRail = false;
  let projectsBlocking = false;
  let chromeBound = false;

  function init(appRoot, options = {}) {
    root = appRoot;
    opts = options;
    ensureChrome();
    bindChrome();
    if (!tutorialDone) showTutorial(true);
  }

  function ensureChrome() {
    if (document.getElementById("studioRail")) {
      pruneChipLists(document.getElementById("studioRail"));
      return;
    }
    const rail = document.createElement("aside");
    rail.id = "studioRail";
    rail.className = "studio-rail";
    rail.innerHTML = `
      <div class="studio-rail-head">
        <div><strong>Looks</strong><span>Presets</span></div>
        <button type="button" class="icon-btn" id="btnCloseStudioRail" aria-label="Close looks panel">×</button>
      </div>
      <div class="studio-block">
        <header>Presets</header>
        <label class="studio-dropdown">
          <select id="presetSelect" aria-label="Choose a look">
            <option value="">Choose a look…</option>
          </select>
        </label>
      </div>
      <div class="studio-block studio-toggles">
        <button type="button" class="chrome-btn" id="btnCropTool" title="Crop / straighten">Crop</button>
        <button type="button" class="chrome-btn" id="btnLightWidget" title="Drag sun direction">Light</button>
      </div>
      <details class="studio-block studio-more">
        <summary>More</summary>
        <div class="studio-toggles">
          <button type="button" class="chrome-btn" id="btnRegionLock" title="Adjust only painted mask">Region lock</button>
          <button type="button" class="chrome-btn" id="btnSoftProof" title="Soft-proof cool grade">Soft-proof</button>
          <button type="button" class="chrome-btn" id="btnKeepExif" title="Write a JSON sidecar of edit settings (not camera EXIF)" data-on="true">Sidecar on</button>
          <button type="button" class="chrome-btn" id="btnBatchExport" title="Batch export folder">Batch</button>
          <button type="button" class="chrome-btn" id="btnProjectPack" title="Export/import project pack">Pack</button>
          <button type="button" class="chrome-btn" id="btnTutorial" title="Tutorial">Help</button>
        </div>
      </details>
    `;
    root.appendChild(rail);
    ensureRailTab();

    const light = document.createElement("div");
    light.id = "lightWidget";
    light.className = "light-widget";
    light.hidden = true;
    light.innerHTML = `
      <header>Light field</header>
      <div class="light-pad" id="lightPad" title="Drag to set sun">
        <div class="light-sun" id="lightSun"></div>
      </div>
      <label>Sun <input type="range" id="lightSunAngle" min="0" max="90" value="35" /></label>
      <label>Azimuth <input type="range" id="lightAzimuth" min="-180" max="180" value="0" /></label>
    `;
    root.appendChild(light);

    const crop = document.createElement("div");
    crop.id = "cropBar";
    crop.className = "crop-bar";
    crop.hidden = true;
    crop.innerHTML = `
      <span>Crop / straighten</span>
      <label>Straighten <input type="range" id="cropStraighten" min="-15" max="15" step="0.1" value="0" /></label>
      <button type="button" class="chrome-btn" id="btnCropApply">Apply</button>
      <button type="button" class="chrome-btn" id="btnCropCancel">Cancel</button>
    `;
    root.appendChild(crop);

    const compare = document.createElement("div");
    compare.id = "compareModes";
    compare.className = "compare-modes";
    compare.innerHTML = `
      <button type="button" class="chrome-btn" data-compare="swipe" title="Swipe A/B">Swipe</button>
      <button type="button" class="chrome-btn" data-compare="split" title="Split A/B">Split</button>
      <button type="button" class="chrome-btn" data-compare="blink" title="Blink A/B">Blink</button>
    `;
    document.getElementById("workRail")?.prepend(compare);

    const clip = document.createElement("canvas");
    clip.id = "clipOverlay";
    clip.className = "clip-overlay";
    clip.hidden = true;
    document.getElementById("canvasZone")?.appendChild(clip);

    const tut = document.createElement("div");
    tut.id = "tutorialOverlay";
    tut.className = "tutorial-overlay";
    tut.hidden = true;
    tut.innerHTML = `
      <div class="tutorial-card">
        <h2>Welcome to BUKA PHOTO PRO</h2>
        <ol>
          <li><strong>Open</strong> a photo, a RAW preview, or <strong>Live camera</strong></li>
          <li>Use <strong>Compose</strong>, <strong>Transparent</strong>, or <strong>Studio</strong> for a cutout</li>
          <li><strong>Erase</strong> (<kbd>E</kbd>) removes objects and rebuilds what was behind</li>
          <li>Use the <strong>Adjust</strong> panel on the right</li>
          <li><strong>Export…</strong> to save a PNG or JPEG — optional resize</li>
          <li><strong>Save</strong> writes a project file you can open later</li>
          <li>Quit from the <strong>tray icon</strong> (near the clock) when you are done</li>
        </ol>
        <p class="tutorial-more">Full walkthrough: <strong>Tools → Help → User Guide</strong></p>
        <button type="button" class="cta" id="btnTutorialDone">Got it</button>
      </div>
    `;
    root.appendChild(tut);

    const batchInput = document.createElement("input");
    batchInput.id = "batchInput";
    batchInput.className = "sr-only";
    batchInput.type = "file";
    batchInput.accept = "image/*";
    batchInput.multiple = true;
    root.appendChild(batchInput);

    renderPresetMenu();
  }

  function pruneChipLists(rail) {
    rail.querySelector("#recipeChips")?.closest(".studio-block")?.remove();
    rail.querySelector("#materialChips")?.closest(".studio-block")?.remove();
    rail.querySelector("#presetChips")?.closest(".studio-block")?.remove();
    ensureRailHead(rail);
    ensureRailTab();
    mountPresetDropdown(rail);
  }

  function ensureRailHead(rail) {
    if (!rail || rail.querySelector(".studio-rail-head")) return;
    const head = document.createElement("div");
    head.className = "studio-rail-head";
    head.innerHTML = `
      <div><strong>Looks</strong><span>Presets</span></div>
      <button type="button" class="icon-btn" id="btnCloseStudioRail" aria-label="Close looks panel">×</button>
    `;
    rail.prepend(head);
  }

  function ensureRailTab() {
    if (document.getElementById("studioRailTab")) return;
    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = "studioRailTab";
    tab.className = "studio-rail-tab";
    tab.hidden = true;
    tab.setAttribute("aria-label", "Open looks panel");
    tab.textContent = "Looks";
    (root || document.getElementById("app"))?.appendChild(tab);
  }

  function mountPresetDropdown(rail) {
    const host = rail || document.getElementById("studioRail");
    if (!host) return;
    let select = host.querySelector("#presetSelect");
    if (!select) {
      const first = host.querySelector(".studio-block");
      if (!first) return;
      first.innerHTML = `
        <header>Presets</header>
        <label class="studio-dropdown">
          <select id="presetSelect" aria-label="Choose a look"></select>
        </label>
      `;
      select = first.querySelector("#presetSelect");
    }
    const keep = select.value;
    select.innerHTML = `<option value="">Choose a look…</option>${PRESETS.map(
      (p) => `<option value="${p.id}">${p.label}</option>`
    ).join("")}`;
    if (keep && PRESETS.some((p) => p.id === keep)) select.value = keep;
  }

  function renderPresetMenu() {
    mountPresetDropdown(document.getElementById("studioRail"));
  }

  function bindChrome() {
    if (chromeBound) return;
    chromeBound = true;
    const presetSelect = document.getElementById("presetSelect");

    function applyPreset(id) {
      const p = PRESETS.find((x) => x.id === id);
      if (!p) return;
      if (presetSelect) presetSelect.value = id;
      opts.onPreset?.(p);
    }

    presetSelect?.addEventListener("change", () => {
      const id = presetSelect.value;
      if (!id) return;
      applyPreset(id);
    });
    document.getElementById("btnCloseStudioRail")?.addEventListener("click", () => setRailOpen(false));
    document.getElementById("studioRailTab")?.addEventListener("click", () => setRailOpen(true));
    document.getElementById("btnRegionLock")?.addEventListener("click", () => {
      regionLock = !regionLock;
      document.getElementById("btnRegionLock").classList.toggle("active", regionLock);
      LuminaEngine.setRegionLock(regionLock);
      opts.onToast?.(regionLock ? "Region lock on — paint mask (M), then adjust" : "Region lock off");
    });

    document.getElementById("btnSoftProof")?.addEventListener("click", () => {
      softProof = !softProof;
      document.getElementById("btnSoftProof").classList.toggle("active", softProof);
      LuminaEngine.setSoftProof(softProof);
      opts.onToast?.(softProof ? "Soft-proof on" : "Soft-proof off");
    });

    document.getElementById("btnKeepExif")?.addEventListener("click", () => {
      keepExif = !keepExif;
      const btn = document.getElementById("btnKeepExif");
      btn.dataset.on = keepExif ? "true" : "false";
      btn.textContent = keepExif ? "Sidecar on" : "Sidecar off";
      btn.classList.toggle("active", keepExif);
      opts.onToast?.(keepExif ? "PNG + sidecar export will include edit settings" : "Sidecar file will be skipped");
    });

    document.getElementById("btnCropTool")?.addEventListener("click", () => setCropMode(!cropMode));
    document.getElementById("btnCropCancel")?.addEventListener("click", () => setCropMode(false));
    document.getElementById("btnCropApply")?.addEventListener("click", () => {
      const ang = Number(document.getElementById("cropStraighten").value) || 0;
      opts.onCropApply?.({ straighten: ang, ...cropDraft });
      setCropMode(false);
    });
    document.getElementById("cropStraighten")?.addEventListener("input", (e) => {
      LuminaEngine.setStraightenPreview(Number(e.target.value) || 0);
    });

    document.getElementById("btnLightWidget")?.addEventListener("click", () => {
      const el = document.getElementById("lightWidget");
      el.hidden = !el.hidden;
    });
    wireLightPad();

    document.getElementById("btnBatchExport")?.addEventListener("click", () => {
      document.getElementById("batchInput").click();
    });
    document.getElementById("batchInput")?.addEventListener("change", async (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = "";
      if (files.length) await opts.onBatch?.(files);
    });

    document.getElementById("btnProjectPack")?.addEventListener("click", () => opts.onProjectPack?.());
    document.getElementById("btnTutorial")?.addEventListener("click", () => showTutorial(true));
    document.getElementById("btnTutorialDone")?.addEventListener("click", () => {
      tutorialDone = true;
      localStorage.setItem("lumina-tutorial-v1", "1");
      showTutorial(false);
    });

    document.getElementById("compareModes")?.addEventListener("click", (e) => {
      const mode = e.target.closest("[data-compare]")?.dataset.compare;
      if (mode) cycleCompare(mode);
    });
  }

  function wireLightPad() {
    const pad = document.getElementById("lightPad");
    const sun = document.getElementById("lightSun");
    const ang = document.getElementById("lightSunAngle");
    const az = document.getElementById("lightAzimuth");
    if (!pad) return;

    function applyFromUI() {
      opts.onLight?.({ sunAngle: Number(ang.value), azimuth: Number(az.value) });
      const a = (Number(ang.value) / 90) * 0.45;
      const z = ((Number(az.value) + 180) / 360);
      sun.style.left = `${10 + z * 80}%`;
      sun.style.top = `${15 + a * 70}%`;
    }
    ang?.addEventListener("input", applyFromUI);
    az?.addEventListener("input", applyFromUI);

    let dragging = false;
    pad.addEventListener("pointerdown", (e) => {
      dragging = true;
      pad.setPointerCapture(e.pointerId);
      move(e);
    });
    pad.addEventListener("pointermove", (e) => {
      if (dragging) move(e);
    });
    pad.addEventListener("pointerup", () => {
      dragging = false;
    });
    function move(e) {
      const r = pad.getBoundingClientRect();
      const nx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const ny = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      az.value = String(Math.round(nx * 360 - 180));
      ang.value = String(Math.round(ny * 90));
      applyFromUI();
    }
    applyFromUI();
  }

  function setCropMode(on) {
    cropMode = on;
    document.getElementById("cropBar").hidden = !on;
    document.getElementById("btnCropTool")?.classList.toggle("active", on);
    if (!on) {
      cropDraft = null;
      LuminaEngine.setStraightenPreview(0);
      document.getElementById("cropStraighten").value = "0";
    } else {
      cropDraft = { cropL: 0.05, cropT: 0.05, cropR: 0.95, cropB: 0.95 };
      opts.onToast?.("Adjust straighten, then Apply crop");
    }
  }

  function cycleCompare(mode) {
    clearInterval(blinkTimer);
    blinkTimer = null;
    if (mode === "off" || compareMode === mode) {
      compareMode = "off";
      LuminaEngine.setCompare(false);
      opts.onCompare?.(false, "off");
      syncCompareButtons();
      return;
    }
    compareMode = mode;
    if (mode === "blink") {
      let on = true;
      LuminaEngine.setCompare(true, 0.5);
      blinkTimer = setInterval(() => {
        on = !on;
        LuminaEngine.setCompare(on, on ? 1 : 0);
      }, 550);
    } else {
      LuminaEngine.setCompare(true, 0.5);
    }
    opts.onCompare?.(true, mode);
    syncCompareButtons();
  }

  function syncCompareButtons() {
    document.getElementById("compareModes")?.classList.toggle("is-open", compareMode !== "off");
    document.querySelectorAll("#compareModes [data-compare]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.compare === compareMode);
    });
  }

  function updateHistoryUI() {
    /* History scrubber removed from live view — Graph undo remains */
  }

  function showTutorial(on) {
    const el = document.getElementById("tutorialOverlay");
    if (el) el.hidden = !on;
  }

  function syncRail() {
    const showRail = sceneReady && !userClosedRail && !projectsBlocking;
    const showTab = sceneReady && !showRail && !projectsBlocking;
    document.getElementById("studioRail")?.classList.toggle("visible", showRail);
    const tab = document.getElementById("studioRailTab");
    if (tab) {
      tab.hidden = !showTab;
      tab.classList.toggle("visible", showTab);
    }
  }

  function setSceneVisible(on) {
    sceneReady = !!on;
    if (on) userClosedRail = false;
    else userClosedRail = false;
    syncRail();
  }

  function setProjectsOpen(on) {
    projectsBlocking = !!on;
    syncRail();
  }

  function setRailOpen(on) {
    userClosedRail = !on;
    if (on) userClosedRail = false;
    syncRail();
  }

  function getKeepExif() {
    return keepExif;
  }

  function getRegionLock() {
    return regionLock;
  }

  function registerPlugin(plugin) {
    plugins.push(plugin);
    opts.onToast?.(`Plugin “${plugin.name || "untitled"}” registered`);
    return plugins.length;
  }

  function listPlugins() {
    return plugins.slice();
  }

  function getPresets() {
    return PRESETS.slice();
  }

  function getMaterials() {
    return MATERIALS.slice();
  }

  return {
    init,
    setSceneVisible,
    setProjectsOpen,
    setRailOpen,
    updateHistoryUI,
    showTutorial,
    getKeepExif,
    getRegionLock,
    registerPlugin,
    listPlugins,
    getPresets,
    getMaterials,
    cycleCompare,
    getCompareMode: () => compareMode,
  };
})();
