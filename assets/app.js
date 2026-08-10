/**
 * Lumina OS — full shell: reconstruct → segment → live graph → HUD / intent / voice / persist.
 */
(() => {
  const app = document.getElementById("app");
  const fileInput = document.getElementById("fileInput");
  const intentInput = document.getElementById("intentInput");
  const intentForm = document.getElementById("intentForm");
  const intentSliders = document.getElementById("intentSliders");
  const thoughtGraph = document.getElementById("thoughtGraph");
  const projectsPanel = document.getElementById("projectsPanel");
  const toastEl = document.getElementById("toast");
  const viewBadge = document.getElementById("viewBadge");
  const chromeMeta = document.getElementById("chromeMeta");
  const btnVoice = document.getElementById("btnVoice");

  let altHeld = false;
  let toastTimer = null;
  let compareOn = false;
  let paintMode = false;
  let painting = false;
  let sessionId = null;
  let fileName = "";
  let globalParams = LuminaEngine.getDefaultParams();

  LuminaEngine.init(
    document.getElementById("sceneCanvas"),
    document.getElementById("overlayCanvas")
  );

  LuminaGraph.init(
    document.getElementById("graphNodes"),
    document.getElementById("graphEdges"),
    (state) => {
      LuminaEngine.setLastParams(mergedParams(state));
      LuminaEngine.evaluate(state, { params: globalParams, targetId: state.activeId });
      autoSaveSoft();
    }
  );

  LuminaHud.init(document.getElementById("materialHud"), {
    onParam: (patch, entity) => {
      Object.assign(globalParams, patch);
      const state = LuminaGraph.getState();
      const active = state.activeId;
      if (active && active !== "import") {
        LuminaGraph.updateNodeParams(active, patch, true);
      } else {
        // Create a polish node for this entity
        const parent = LuminaGraph.latest()?.id || "import";
        LuminaGraph.addNode({
          title: `${entity.name} Polish`,
          type: entity.id === "eyes" || entity.id === "skin" ? "portrait" : entity.id === "sky" ? "atmosphere" : "relight",
          branch: "root",
          parent,
          params: { ...patch },
          meta: { entityId: entity.id },
          x: 20,
          y: 24 + state.nodes.length * 72,
        });
      }
      populateIntentSliders(entity.controls);
    },
  });

  if (!LuminaVoice.supported()) {
    btnVoice.disabled = true;
    btnVoice.title = "Voice not supported in this browser";
  }

  function mergedParams(state) {
    const active = state.nodes.find((n) => n.id === state.activeId);
    return { ...globalParams, ...(active?.params || {}) };
  }

  function toast(message) {
    toastEl.hidden = false;
    toastEl.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 3400);
  }

  function setView(mode) {
    app.dataset.view = mode;
    viewBadge.textContent = mode === "scenescape" ? "Scenescape" : "Photobase";
    LuminaEngine.setViewMode(mode);
  }

  async function bootstrapFromImage(image, meta = {}) {
    const profile = meta.profile || LuminaReconstruct.CAMERA_PROFILES.default;
    toast("Reconstructing depth · materials · light field…");
    const scene = await LuminaReconstruct.ingest(image, profile, {
      fromRaw: !!meta.fromRaw,
      fileName: meta.fileName || "",
    });
    scene.faces = await LuminaSegment.detectFaces(scene.working.canvas);
    LuminaEngine.setScene(scene);
    LuminaEngine.setEntities(LuminaSegment.buildEntities(scene));

    Object.assign(globalParams, {
      sunAngle: scene.lightField.sunAngle,
      azimuth: scene.lightField.azimuth,
    });

    sessionId = `p_${Date.now()}`;
    fileName = meta.fileName || "untitled";
    app.classList.remove("empty");
    LuminaGraph.reset({
      fileName,
      fromRaw: !!meta.fromRaw,
      profile: profile.name,
      faces: scene.faces.length,
    });

    chromeMeta.textContent = [
      profile.name,
      meta.fromRaw ? "RAW preview" : "RGB",
      `${scene.faces.length} face(s)`,
      `${LuminaEngine.getEntities().length} entities`,
    ].join(" · ");

    toast(
      `Scene reconstructed · ${profile.name}` +
        (meta.fromRaw ? " · RAW embedded preview" : "") +
        (scene.faces.length ? " · portrait entities ready" : "")
    );
  }

  async function openFile(file) {
    if (!file) return;
    try {
      const decoded = await LuminaReconstruct.decodeFile(file);
      await bootstrapFromImage(decoded.image, {
        profile: decoded.profile,
        fromRaw: decoded.fromRaw,
        fileName: decoded.fileName,
      });
    } catch (err) {
      toast(err.message || "Failed to open file");
    }
  }

  async function openDemo() {
    const canvas = LuminaDemo.createLandscape();
    await bootstrapFromImage(canvas, {
      profile: LuminaReconstruct.CAMERA_PROFILES.demo,
      fromRaw: false,
      fileName: "demo-landscape.png",
    });
  }

  function resetSession() {
    LuminaPersist.save(currentProject());
    location.reload();
  }

  function currentProject() {
    return {
      id: sessionId || `p_${Date.now()}`,
      name: fileName || "Lumina session",
      savedAt: Date.now(),
      fileName,
      globalParams: { ...globalParams },
      graph: LuminaGraph.getState(),
      basePng: LuminaEngine.exportBasePng(),
      thumb: LuminaEngine.exportWorkingPng(),
      meta: {
        profile: LuminaEngine.getScene()?.profile?.name,
        fromRaw: LuminaEngine.getScene()?.fromRaw,
      },
    };
  }

  let saveTimer = null;
  function autoSaveSoft() {
    if (app.classList.contains("empty") || !sessionId) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        LuminaPersist.save(currentProject());
      } catch (_) {}
    }, 1200);
  }

  function runIntent(text) {
    if (app.classList.contains("empty")) {
      toast("Open an image first");
      return;
    }
    const recipe = LuminaIntent.parse(text);
    if (!recipe) return;

    if (recipe.selectEntity) {
      const entity = LuminaSegment.findByName(LuminaEngine.getEntities(), recipe.selectEntity);
      if (!entity) {
        toast(`No entity matching “${recipe.selectEntity}”`);
        return;
      }
      const bounds = LuminaEngine.entityScreenBounds(entity);
      LuminaHud.show(entity, bounds, { ...globalParams, ...LuminaGraph.getState().nodes.find((n) => n.id === LuminaGraph.getState().activeId)?.params });
      toast(recipe.toast);
      return;
    }

    if (recipe.isBlend) {
      const blend = LuminaGraph.blendSelected(maskConfigFromUI());
      if (!blend) toast("Select two branch nodes, then blend");
      else toast("Blend node evaluated with volumetric masks");
      thoughtGraph.dataset.open = "true";
      return;
    }

    const parent = LuminaGraph.latest()?.id || "import";
    const yBase = 24 + LuminaGraph.getState().nodes.length * 72;

    if (recipe.split) {
      LuminaGraph.addNode({
        title: "Scene Logic",
        type: "branch",
        branch: "root",
        parent,
        x: 20,
        y: yBase,
        params: {},
      });
      LuminaGraph.addNode({
        title: recipe.title,
        type: recipe.type,
        branch: recipe.branch,
        parent,
        x: 180,
        y: yBase,
        params: { ...recipe.params },
        meta: { prompt: recipe.prompt, entityId: recipe.entityHint },
      });
    } else {
      LuminaGraph.addNode({
        title: recipe.title,
        type: recipe.type,
        branch: recipe.branch,
        parent,
        x: recipe.branch === "light" ? 180 : 20,
        y: yBase,
        params: { ...recipe.params },
        meta: { prompt: recipe.prompt, entityId: recipe.entityHint },
      });
    }

    Object.assign(globalParams, recipe.params);
    populateIntentSliders(recipe.sliders);
    thoughtGraph.dataset.open = "true";
    intentInput.value = "";
    toast(recipe.toast);
  }

  function maskConfigFromUI() {
    const mode = document.getElementById("blendMaskMode").value;
    if (mode === "invert") return { sky: "a", mountains: "b", foreground: "b" };
    if (mode === "painted") return { sky: "b", mountains: "a", foreground: "a", painted: true };
    return { sky: "b", mountains: "a", foreground: "a" };
  }

  function populateIntentSliders(sliders) {
    if (!sliders?.length) {
      intentSliders.hidden = true;
      intentSliders.innerHTML = "";
      return;
    }
    const params = { ...globalParams, ...(LuminaGraph.getState().nodes.find((n) => n.id === LuminaGraph.getState().activeId)?.params || {}) };
    intentSliders.innerHTML = "";
    for (const s of sliders) {
      const wrap = document.createElement("div");
      wrap.className = "param-slider";
      const value = params[s.key] ?? 0;
      const display = s.max > 1 ? Math.round(value) : Math.round(value * 100);
      wrap.innerHTML = `
        <label><span>${s.label}</span><span data-val>${display}</span></label>
        <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${value}" data-key="${s.key}" />
      `;
      const input = wrap.querySelector("input");
      const valEl = wrap.querySelector("[data-val]");
      input.addEventListener("input", () => {
        const v = Number(input.value);
        valEl.textContent = String(s.max > 1 ? Math.round(v) : Math.round(v * 100));
        Object.assign(globalParams, { [s.key]: v });
        const active = LuminaGraph.getState().activeId;
        if (active) LuminaGraph.updateNodeParams(active, { [s.key]: v }, true);
      });
      intentSliders.appendChild(wrap);
    }
    intentSliders.hidden = false;
  }

  function renderProjects() {
    const list = document.getElementById("projectsList");
    const items = LuminaPersist.list();
    if (!items.length) {
      list.innerHTML = `<p class="hint-muted">No saved projects yet.</p>`;
      return;
    }
    list.innerHTML = items
      .map(
        (p) => `
      <button type="button" class="project-row" data-id="${p.id}">
        <strong>${escapeHtml(p.name)}</strong>
        <span>${new Date(p.savedAt).toLocaleString()}</span>
      </button>`
      )
      .join("");
    list.querySelectorAll(".project-row").forEach((btn) => {
      btn.addEventListener("click", () => loadProject(btn.dataset.id));
    });
  }

  async function loadProject(id) {
    const p = LuminaPersist.get(id);
    const src = p?.basePng || p?.thumb;
    if (!src) {
      toast("Project missing image data — open a file and re-save");
      return;
    }
    const img = await dataUrlToImage(src);
    await bootstrapFromImage(img, {
      profile: LuminaReconstruct.CAMERA_PROFILES.default,
      fileName: p.fileName || p.name,
    });
    if (p.globalParams) Object.assign(globalParams, p.globalParams);
    if (p.graph) LuminaGraph.loadState(p.graph);
    sessionId = p.id;
    projectsPanel.dataset.open = "false";
    projectsPanel.hidden = true;
    toast(`Loaded project “${p.name}”`);
  }

  function dataUrlToImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function exportAll() {
    if (!LuminaEngine.hasScene()) return;
    const stamp = Date.now();
    const png = LuminaEngine.exportWorkingPng() || LuminaEngine.exportPng();
    const a = document.createElement("a");
    a.href = png;
    a.download = `lumina-${stamp}.png`;
    a.click();

    const sidecar = LuminaPersist.exportSidecar({
      version: "0.2.0",
      exportedAt: new Date().toISOString(),
      fileName,
      profile: LuminaEngine.getScene()?.profile,
      lightField: LuminaEngine.getScene()?.lightField,
      entities: LuminaEngine.getEntities().map((e) => ({ id: e.id, name: e.name, score: e.score })),
      globalParams,
      graph: LuminaGraph.getState(),
      faces: LuminaEngine.getScene()?.faces,
    });
    LuminaPersist.download(`lumina-${stamp}.json`, sidecar);
    toast("Exported PNG + Thought Graph sidecar");
  }

  // —— Events ——
  document.getElementById("btnOpen").addEventListener("click", () => fileInput.click());
  document.getElementById("btnDemo").addEventListener("click", openDemo);
  document.getElementById("btnProjectsEmpty")?.addEventListener("click", () => {
    projectsPanel.hidden = false;
    projectsPanel.dataset.open = "true";
    renderProjects();
  });

  fileInput.addEventListener("change", () => {
    openFile(fileInput.files?.[0]);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) => window.addEventListener(evt, (e) => e.preventDefault()));
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) openFile(file);
  });

  document.getElementById("btnToggleGraph").addEventListener("click", () => {
    thoughtGraph.dataset.open = thoughtGraph.dataset.open === "true" ? "false" : "true";
  });
  document.getElementById("btnCloseGraph").addEventListener("click", () => {
    thoughtGraph.dataset.open = "false";
  });
  document.getElementById("btnBlendBranches").addEventListener("click", () => {
    const blend = LuminaGraph.blendSelected(maskConfigFromUI());
    if (!blend) toast("Select two branch nodes in the Thought Graph, then blend");
    else toast("Blend evaluated · volumetric material masks applied");
  });

  document.getElementById("btnCompare").addEventListener("click", () => {
    compareOn = !compareOn;
    LuminaEngine.setCompare(compareOn, 0.5);
    document.getElementById("btnCompare").classList.toggle("active", compareOn);
    toast(compareOn ? "A/B compare on — drag horizontally" : "A/B compare off");
  });

  document.getElementById("btnPaint").addEventListener("click", () => {
    paintMode = !paintMode;
    document.getElementById("btnPaint").classList.toggle("active", paintMode);
    app.classList.toggle("paint-mode", paintMode);
    toast(paintMode ? "Mask paint on — drag on canvas · Shift erases" : "Mask paint off");
  });

  document.getElementById("btnUndo").addEventListener("click", () => {
    if (LuminaGraph.undo()) toast("Undid last graph change");
    else toast("Nothing to undo");
  });

  document.getElementById("btnSave").addEventListener("click", () => {
    if (app.classList.contains("empty")) return;
    LuminaPersist.save(currentProject());
    toast("Project saved locally");
  });

  document.getElementById("btnProjects").addEventListener("click", () => {
    const open = projectsPanel.dataset.open === "true";
    projectsPanel.hidden = open;
    projectsPanel.dataset.open = open ? "false" : "true";
    if (!open) renderProjects();
  });
  document.getElementById("btnCloseProjects").addEventListener("click", () => {
    projectsPanel.dataset.open = "false";
    projectsPanel.hidden = true;
  });

  document.getElementById("btnExport").addEventListener("click", exportAll);
  document.getElementById("btnReset").addEventListener("click", resetSession);

  intentForm.addEventListener("submit", (e) => {
    e.preventDefault();
    runIntent(intentInput.value);
  });

  btnVoice.addEventListener("click", () => {
    if (LuminaVoice.isListening()) {
      LuminaVoice.stop();
      btnVoice.classList.remove("listening");
      return;
    }
    const ok = LuminaVoice.start({
      onResult: (text) => {
        intentInput.value = text;
        runIntent(text);
        btnVoice.classList.remove("listening");
      },
      onError: (err) => {
        toast(`Voice: ${err}`);
        btnVoice.classList.remove("listening");
      },
      onEnd: () => btnVoice.classList.remove("listening"),
    });
    if (ok) {
      btnVoice.classList.add("listening");
      toast("Listening…");
    }
  });

  const canvasZone = document.getElementById("canvasZone");
  const materialHud = document.getElementById("materialHud");

  canvasZone.addEventListener("pointermove", (e) => {
    if (app.classList.contains("empty")) return;
    if (materialHud.contains(e.target)) return;

    const nx = e.clientX / window.innerWidth;
    const ny = e.clientY / window.innerHeight;

    if (paintMode && painting) {
      LuminaEngine.paintAt(nx, ny, 0.045, e.shiftKey ? 0 : 1);
      // re-eval if blend exists
      const st = LuminaGraph.getState();
      if (st.nodes.some((n) => n.type === "blend")) LuminaEngine.evaluate(st, { params: globalParams, targetId: st.activeId });
      return;
    }

    if (compareOn && e.buttons === 1) {
      LuminaEngine.setCompare(true, nx);
      return;
    }

    if (altHeld) {
      LuminaEngine.setParallax(nx * 2 - 1, ny * 2 - 1);
      LuminaEngine.setOrbit((nx - 0.5) * 0.8, (ny - 0.5) * 0.5);
    }

    const entity = LuminaSegment.hitTest(LuminaEngine.getEntities(), nx, ny);
    if (!entity) {
      LuminaHud.hide();
      return;
    }
    LuminaHud.show(entity, LuminaEngine.entityScreenBounds(entity), {
      ...globalParams,
      ...(LuminaGraph.getState().nodes.find((n) => n.id === LuminaGraph.getState().activeId)?.params || {}),
    });
  });

  canvasZone.addEventListener("pointerdown", (e) => {
    if (paintMode) {
      painting = true;
      canvasZone.setPointerCapture(e.pointerId);
      const nx = e.clientX / window.innerWidth;
      const ny = e.clientY / window.innerHeight;
      LuminaEngine.paintAt(nx, ny, 0.045, e.shiftKey ? 0 : 1);
    }
  });
  canvasZone.addEventListener("pointerup", () => {
    painting = false;
  });
  canvasZone.addEventListener("pointerleave", (e) => {
    if (materialHud.contains(e.relatedTarget)) return;
    if (!paintMode) LuminaHud.hide();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Alt") {
      altHeld = true;
      if (!app.classList.contains("empty")) setView("scenescape");
      e.preventDefault();
    }
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "l") {
      e.preventDefault();
      intentInput.focus();
      intentInput.select();
    }
    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (LuminaGraph.undo()) toast("Undo");
    }
    if (meta && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (!app.classList.contains("empty")) {
        LuminaPersist.save(currentProject());
        toast("Saved");
      }
    }
    if (document.activeElement === intentInput) return;
    if (e.key.toLowerCase() === "g") {
      thoughtGraph.dataset.open = thoughtGraph.dataset.open === "true" ? "false" : "true";
    }
    if (e.key.toLowerCase() === "c") {
      document.getElementById("btnCompare").click();
    }
    if (e.key.toLowerCase() === "m") {
      document.getElementById("btnPaint").click();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "Alt") {
      altHeld = false;
      setView("photobase");
    }
  });
  window.addEventListener("blur", () => {
    if (altHeld) {
      altHeld = false;
      setView("photobase");
    }
  });

  window.LuminaOS = {
    version: "0.2.0",
    openDemo,
    openFile,
    runIntent,
    getGraph: () => LuminaGraph.getState(),
    getParams: () => ({ ...globalParams }),
    setParams: (p) => {
      Object.assign(globalParams, p);
      const st = LuminaGraph.getState();
      if (st.activeId) LuminaGraph.updateNodeParams(st.activeId, p, true);
    },
    getEntities: () => LuminaEngine.getEntities(),
    getScene: () => LuminaEngine.getScene(),
    exportPng: () => LuminaEngine.exportPng(),
    exportWorkingPng: () => LuminaEngine.exportWorkingPng(),
    saveProject: () => LuminaPersist.save(currentProject()),
    listProjects: () => LuminaPersist.list(),
    undo: () => LuminaGraph.undo(),
    blendSelected: () => LuminaGraph.blendSelected(maskConfigFromUI()),
  };
})();
