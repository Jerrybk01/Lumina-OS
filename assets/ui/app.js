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
  let projectHandle = null;
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
      LuminaEngine.scheduleEvaluate(state, { params: globalParams, targetId: state.activeId });
      LuminaHud.syncValues(mergedParams(state));
      autoSaveSoft();
    }
  );

  LuminaHud.init(document.getElementById("materialHud"), {
    onParam: (patch) => {
      Object.assign(globalParams, patch);
      const state = LuminaGraph.getState();
      const active = state.activeId;
      const activeNode = state.nodes.find((n) => n.id === active);
      if (active && active !== "import" && activeNode?.type === "adjust") {
        LuminaGraph.updateNodeParams(active, patch, true);
      } else {
        const parent = LuminaGraph.latest()?.id || "import";
        LuminaGraph.addNode({
          title: "Adjust",
          type: "adjust",
          branch: "root",
          parent,
          params: { ...patch },
          meta: { source: "dock" },
          x: 20,
          y: 24 + state.nodes.length * 72,
        });
      }
    },
  });

  if (!LuminaVoice.supported()) {
    btnVoice.disabled = true;
    btnVoice.title = "Voice not supported in this browser";
  }

  LuminaStudio.init(app, {
    onToast: (m) => toast(m),
    onPreset: (preset) => {
      applyTool({ id: preset.id, label: preset.label, type: "adjust", params: preset.params });
      LuminaHud.showAdjust(mergedParams(LuminaGraph.getState()));
    },
    onRecipe: (intent) => runIntent(intent),
    onMaterial: (mat) => {
      applyTool({ id: mat.id, label: mat.label, type: mat.type, params: mat.params });
    },
    onLight: (patch) => {
      Object.assign(globalParams, patch);
      const state = LuminaGraph.getState();
      const active = state.nodes.find((n) => n.id === state.activeId);
      if (active && active.type === "relight") LuminaGraph.updateNodeParams(active.id, patch, true);
      else {
        LuminaGraph.addNode({
          title: "Light field",
          type: "relight",
          branch: "light",
          parent: LuminaGraph.latest()?.id || "import",
          params: { ...patch },
          x: 180,
          y: 24 + state.nodes.length * 72,
        });
      }
    },
    onCropApply: ({ straighten, cropL, cropT, cropR, cropB }) => {
      applyTool({
        id: "crop-straighten",
        label: "Crop / Straighten",
        type: "transform",
        params: {
          straighten: straighten || 0,
          cropL: cropL ?? 0.05,
          cropT: cropT ?? 0.05,
          cropR: cropR ?? 0.95,
          cropB: cropB ?? 0.95,
        },
      });
    },
    onCompare: (on, mode) => {
      compareOn = on;
      document.getElementById("btnCompare").classList.toggle("active", on);
      toast(on ? `Compare: ${mode}` : "Compare off");
    },
    onBatch: async (files) => {
      toast(`Batch: processing ${files.length} file(s)…`);
      const params = { ...globalParams };
      for (const file of files) {
        try {
          const decoded = await LuminaReconstruct.decodeFile(file);
          await bootstrapFromImage(decoded.image, {
            profile: decoded.profile,
            fromRaw: decoded.fromRaw,
            fileName: decoded.fileName,
          });
          Object.assign(globalParams, params);
          LuminaGraph.addNode({
            title: "Batch Adjust",
            type: "adjust",
            parent: "import",
            params: { ...params },
            x: 20,
            y: 100,
          });
          const png = LuminaEngine.exportWorkingPng();
          if (png) {
            await LuminaPersist.saveAs({
              suggestedName: `${(file.name || "batch").replace(/\.[^.]+$/, "")}-lumina.png`,
              dataUrl: png,
              mime: "image/png",
              description: "PNG Image",
              extensions: [".png"],
            });
          }
        } catch (err) {
          toast(`${file.name}: ${err.message || "failed"}`);
        }
      }
      toast("Batch export finished");
    },
    onProjectPack: async () => {
      if (app.classList.contains("empty")) {
        toast("Open a session first");
        return;
      }
      const pack = {
        version: "0.3.0",
        exportedAt: new Date().toISOString(),
        project: currentProject(),
        keepExif: LuminaStudio.getKeepExif(),
      };
      await LuminaPersist.saveAs({
        suggestedName: `${exportBaseName()}-pack.json`,
        text: JSON.stringify(pack, null, 2),
        mime: "application/json",
        description: "BUKA PHOTO PRO Project Pack",
        extensions: [".json"],
      });
      toast("Project pack saved");
    },
  });

  // Touch gestures: pinch zoom + two-finger pan
  (() => {
    const zone = document.getElementById("canvasZone");
    let lastDist = 0;
    let lastMid = null;
    zone?.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          const [a, b] = e.touches;
          lastDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          lastMid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
        }
      },
      { passive: true }
    );
    zone?.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length !== 2 || app.classList.contains("empty")) return;
        e.preventDefault();
        const [a, b] = e.touches;
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const mid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
        if (lastDist) LuminaEngine.zoomBy(dist / lastDist);
        if (lastMid) LuminaEngine.panBy(mid.x - lastMid.x, mid.y - lastMid.y);
        lastDist = dist;
        lastMid = mid;
      },
      { passive: false }
    );
  })();

  // Plugin API hook
  window.LuminaPlugins = {
    register: (plugin) => LuminaStudio.registerPlugin(plugin),
    list: () => LuminaStudio.listPlugins(),
  };

  /** Re-run the graph over the current source pixels. */
  function reEvaluate() {
    const state = LuminaGraph.getState();
    if (state.nodes.length) {
      LuminaEngine.evaluate(state, { params: globalParams, targetId: state.activeId });
    } else {
      LuminaEngine.present();
    }
  }

  /**
   * Erase bakes pixels into the source, so undo has to unwind the pixel edit and
   * its marker node together.
   */
  function undoLast() {
    const state = LuminaGraph.getState();
    const last = state.nodes[state.nodes.length - 1];
    if (last?.type === "erase" && LuminaEngine.canUndoSource()) {
      LuminaEngine.undoSource();
      LuminaGraph.undo();
      toast("Erase undone");
      return true;
    }
    if (LuminaGraph.undo()) {
      toast("Undo");
      return true;
    }
    toast("Nothing to undo");
    return false;
  }

  function redoLast() {
    if (LuminaGraph.redo()) {
      toast("Redo");
      return true;
    }
    toast("Nothing to redo");
    return false;
  }

  function openGuide() {
    const w = window.open("guide.html", "_blank", "noopener");
    if (!w) window.location.assign("guide.html");
  }

  function applyTool(item) {
    if (!LuminaEngine.hasScene()) {
      toast("Open an image first");
      return;
    }
    const parent = LuminaGraph.latest()?.id || "import";
    const state = LuminaGraph.getState();
    const type = item.type || "adjust";
    LuminaGraph.addNode({
      title: item.label,
      type,
      branch: type === "branch" ? "root" : "root",
      parent,
      params: { ...(item.params || {}) },
      meta: { toolId: item.id },
      x: type === "branch" ? 180 : 20,
      y: 24 + state.nodes.length * 72,
    });
    Object.assign(globalParams, item.params || {});
    if (item.sliders?.length) {
      LuminaHud.showAdjust(mergedParams(LuminaGraph.getState()));
      populateIntentSliders(item.sliders);
    }
    thoughtGraph.dataset.open = "true";
    toast(`Applied ${item.label}`);
  }

  function showHistogram() {
    if (!LuminaEngine.hasScene()) {
      toast("Open an image first");
      return;
    }
    let el = document.getElementById("histogramOverlay");
    if (el) {
      el.remove();
      toast("Histogram hidden");
      return;
    }
    el = document.createElement("div");
    el.id = "histogramOverlay";
    el.className = "histogram-overlay";
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 80;
    el.appendChild(canvas);
    app.appendChild(el);

    const png = LuminaEngine.exportWorkingPng();
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
      for (let i = 0; i < data.length; i += 4) {
        hist[0][data[i]]++;
        hist[1][data[i + 1]]++;
        hist[2][data[i + 2]]++;
      }
      const max = Math.max(...hist.map((h) => Math.max(...h)));
      const g = canvas.getContext("2d");
      g.clearRect(0, 0, 200, 80);
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(0, 0, 200, 80);
      const colors = ["rgba(220,90,90,0.55)", "rgba(90,200,120,0.45)", "rgba(90,140,230,0.5)"];
      for (let cidx = 0; cidx < 3; cidx++) {
        g.strokeStyle = colors[cidx];
        g.beginPath();
        for (let x = 0; x < 256; x++) {
          const px = (x / 255) * 200;
          const py = 80 - (hist[cidx][x] / max) * 76;
          if (x === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.stroke();
      }
    };
    img.src = png;
    toast("Histogram shown — click again in View to hide");
  }

  function handleToolsUi(action) {
    switch (action) {
      case "open":
        fileInput.click();
        break;
      case "openRaw":
        document.getElementById("rawInput")?.click();
        break;
      case "openProject":
        document.getElementById("projectInput")?.click();
        break;
      case "camera":
        LuminaCamera.open({ onCapture: openFile, toast });
        break;
      case "record":
        LuminaCamera.open({ onCapture: openFile, toast, record: true });
        break;
      case "erase":
        LuminaErase.open();
        break;
      case "eraseSubject":
        LuminaErase.open();
        LuminaErase.selectSubject();
        break;
      case "eraseUndo":
        LuminaErase.undo();
        break;
      case "compose":
        LuminaErase.close();
        LuminaCompose.openPanel();
        break;
      case "bgRemove":
        LuminaErase.close();
        LuminaCompose.applyBgMode("transparent");
        LuminaCompose.openPanel();
        break;
      case "studioDrop":
        LuminaErase.close();
        LuminaCompose.applyBgMode("studio");
        LuminaCompose.openPanel();
        break;
      case "bgReplace":
        LuminaErase.close();
        LuminaCompose.openPanel();
        LuminaCompose.applyBgMode("image");
        break;
      case "bgReset":
        LuminaCompose.applyBgMode("original");
        break;
      case "addText":
        LuminaCompose.addTextBox();
        document.getElementById("btnText")?.classList.add("active");
        break;
      case "save":
        saveProject();
        break;
      case "saveAs":
        saveProjectAs();
        break;
      case "redo":
        redoLast();
        break;
      case "guide":
        openGuide();
        break;
      case "about":
        toast("BUKA PHOTO PRO — local photo editor. Tools → Help → User Guide");
        break;
      case "projects":
        openProjectsPanel();
        break;
      case "studioRail":
        closeProjectsPanel();
        LuminaStudio.setRailOpen(true);
        break;
      case "deleteCurrent":
        if (sessionId) deleteProject(sessionId);
        else toast("No project to delete — open Projects to manage saves");
        break;
      case "export":
        exportAll();
        break;
      case "exportPng":
        exportImageAs();
        break;
      case "exportResize":
        openSizeDialog("export");
        break;
      case "imageSize":
        openSizeDialog("working");
        break;
      case "print":
        printImage();
        break;
      case "reset":
        resetSession();
        break;
      case "undo":
        undoLast();
        break;
      case "compare":
        document.getElementById("btnCompare").click();
        break;
      case "graph":
        thoughtGraph.dataset.open = thoughtGraph.dataset.open === "true" ? "false" : "true";
        break;
      case "paint":
        document.getElementById("btnPaint").click();
        break;
      case "clearMask":
        LuminaEngine.clearPaint();
        toast("Painted mask cleared");
        break;
      case "blend": {
        const blend = LuminaGraph.blendSelected(maskConfigFromUI());
        if (!blend) toast("Select two branch nodes, then blend");
        else toast("Blend evaluated · volumetric material masks applied");
        thoughtGraph.dataset.open = "true";
        break;
      }
      case "photobase":
        setView("photobase");
        break;
      case "scenescape":
        setView("scenescape");
        toast("Scenescape on — move mouse · release Alt / use Photobase to exit");
        break;
      case "fit":
      case "zoomFit":
      case "zoom100":
        LuminaEngine.zoomFit();
        toast("Fit to screen");
        break;
      case "zoomIn":
        LuminaEngine.zoomIn();
        break;
      case "zoomOut":
        LuminaEngine.zoomOut();
        break;
      case "zoomActual":
        LuminaEngine.zoomActual();
        toast("Actual pixels");
        break;
      case "zoom200":
        LuminaEngine.setZoom(2);
        break;
      case "zoom400":
        LuminaEngine.setZoom(4);
        break;
      case "zoom50":
        LuminaEngine.setZoom(0.5);
        break;
      case "panReset":
        LuminaEngine.setPan(0, 0);
        toast("Pan reset");
        break;
      case "histogram":
        showHistogram();
        break;
      case "fullscreen":
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
        break;
      case "grid": {
        let grid = document.getElementById("gridOverlay");
        if (!grid) {
          grid = document.createElement("div");
          grid.id = "gridOverlay";
          grid.className = "grid-overlay";
          document.getElementById("canvasZone").appendChild(grid);
        }
        grid.classList.toggle("visible");
        toast(grid.classList.contains("visible") ? "Rule-of-thirds grid on" : "Grid off");
        break;
      }
      case "copy":
        copyImageToClipboard();
        break;
      case "paste":
        pasteImageFromClipboard();
        break;
      default:
        break;
    }
  }

  function updateZoomLabel() {
    const label = document.getElementById("btnZoomLabel");
    if (!label) return;
    label.textContent = `${LuminaEngine.getZoomState().percent}%`;
  }

  async function copyImageToClipboard() {
    try {
      const dataUrl = LuminaEngine.exportWorkingPng();
      if (!dataUrl || !navigator.clipboard?.write) {
        toast("Clipboard image copy not available");
        return;
      }
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast("Image copied");
    } catch {
      toast("Could not copy image");
    }
  }

  async function pasteImageFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        const file = new File([blob], "pasted.png", { type });
        await openFile(file);
        return;
      }
      toast("No image on clipboard");
    } catch {
      toast("Clipboard paste blocked — use Open instead");
    }
  }


  LuminaToolsMenu.init(document.getElementById("toolsMenu"), {
    hasScene: () => LuminaEngine.hasScene(),
    toast,
    intent: runIntent,
    applyTool,
    ui: handleToolsUi,
  });

  LuminaEngine.setOnZoomChange(updateZoomLabel);
  document.getElementById("btnZoomIn")?.addEventListener("click", () => LuminaEngine.zoomIn());
  document.getElementById("btnZoomOut")?.addEventListener("click", () => LuminaEngine.zoomOut());
  document.getElementById("btnZoomLabel")?.addEventListener("click", () => {
    LuminaEngine.zoomFit();
    toast("Fit to screen");
  });

  let spaceHeld = false;
  let panning = false;
  let panLast = null;

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement !== intentInput) {
      spaceHeld = true;
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      spaceHeld = false;
      panning = false;
      app.classList.remove("panning");
    }
  });

  const canvasZoneEl = document.getElementById("canvasZone");
  canvasZoneEl.addEventListener(
    "wheel",
    (e) => {
      if (app.classList.contains("empty") || !LuminaEngine.hasScene()) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      LuminaEngine.zoomBy(factor, e.clientX, e.clientY);
    },
    { passive: false }
  );

  canvasZoneEl.addEventListener("pointerdown", (e) => {
    if (spaceHeld || e.button === 1) {
      panning = true;
      panLast = { x: e.clientX, y: e.clientY };
      app.classList.add("panning");
      canvasZoneEl.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });
  canvasZoneEl.addEventListener("pointermove", (e) => {
    if (!panning || !panLast) return;
    LuminaEngine.panBy(e.clientX - panLast.x, e.clientY - panLast.y);
    panLast = { x: e.clientX, y: e.clientY };
  });
  canvasZoneEl.addEventListener("pointerup", () => {
    panning = false;
    panLast = null;
    app.classList.remove("panning");
  });


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
      maxW: meta.maxW,
      size: meta.size,
    });
    scene.faces = await LuminaSegment.detectFaces(scene.working.canvas);
    LuminaEngine.setScene(scene);
    LuminaEngine.setEntities(LuminaSegment.buildEntities(scene));
    LuminaErase.resetForScene();

    Object.assign(globalParams, {
      sunAngle: scene.lightField.sunAngle,
      azimuth: scene.lightField.azimuth,
    });

    sessionId = meta.sessionId || `p_${Date.now()}`;
    fileName = meta.fileName || "untitled";
    if (!meta.keepHandle) projectHandle = null;
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
      `${scene.working.w}×${scene.working.h}`,
      `${scene.faces.length} face(s)`,
      `${LuminaEngine.getEntities().length} entities`,
    ].join(" · ");

    const srcW = image.naturalWidth || image.width;
    const srcH = image.naturalHeight || image.height;
    const capped =
      srcW && srcH && (srcW !== scene.working.w || srcH !== scene.working.h) && !meta.size;
    toast(
      `Scene reconstructed · ${profile.name}` +
        (meta.fromRaw ? " · RAW embedded preview" : "") +
        (capped ? ` · working ${scene.working.w}×${scene.working.h} (source ${srcW}×${srcH})` : "") +
        (scene.faces.length ? " · portrait entities ready" : "")
    );
    LuminaHud.showAdjust(mergedParams(LuminaGraph.getState()));
    LuminaStudio.setSceneVisible(true);
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

  async function openProjectFile(file) {
    if (!file) return;
    try {
      const data = LuminaPersist.readProjectText(await file.text());
      await applyProjectData(data);
      toast(`Opened “${data.name || file.name}”`);
    } catch (err) {
      toast(err.message || "Could not open project file");
    }
  }

  async function applyProjectData(p, handle = null) {
    const src = p?.basePng || p?.thumb;
    if (!src) throw new Error("Project file has no image");
    const img = await dataUrlToImage(src);
    await bootstrapFromImage(img, {
      profile: LuminaReconstruct.CAMERA_PROFILES[p.meta?.profile?.toLowerCase?.()] || LuminaReconstruct.CAMERA_PROFILES.default,
      fromRaw: !!p.meta?.fromRaw,
      fileName: p.fileName || p.name,
      sessionId: p.id,
      keepHandle: true,
    });
    if (p.globalParams) Object.assign(globalParams, p.globalParams);
    if (p.graph) LuminaGraph.loadState(p.graph);
    sessionId = p.id || sessionId;
    projectHandle = handle;
    LuminaHud.showAdjust(mergedParams(LuminaGraph.getState()));
  }

  function projectPayload() {
    return {
      kind: "buka-photo-project",
      version: "1.0",
      ...currentProject(),
    };
  }

  async function saveProject() {
    if (app.classList.contains("empty")) {
      toast("Open an image first");
      return;
    }
    const project = projectPayload();
    LuminaPersist.save(project);
    if (projectHandle) {
      const result = await LuminaPersist.saveProjectFile({ project, handle: projectHandle });
      if (result.cancelled) {
        toast("Save cancelled");
        return;
      }
      if (result.handle) projectHandle = result.handle;
      toast(result.name ? `Saved “${result.name}”` : "Project saved");
      return;
    }
    await saveProjectAs();
  }

  async function saveProjectAs() {
    if (app.classList.contains("empty")) {
      toast("Open an image first");
      return;
    }
    const project = projectPayload();
    LuminaPersist.save(project);
    try {
      const result = await LuminaPersist.saveProjectFile({
        project,
        suggestedName: `${exportBaseName().replace(/-edited$/, "") || "project"}.buka.json`,
        handle: null,
      });
      if (result.cancelled) {
        toast("Save cancelled");
        return;
      }
      if (result.handle) projectHandle = result.handle;
      toast(result.name ? `Saved “${result.name}”` : "Project file saved");
    } catch (err) {
      toast(err.message || "Could not save project file");
    }
  }

  function resetSession() {
    LuminaPersist.save(currentProject());
    location.reload();
  }

  function currentProject() {
    return {
      id: sessionId || `p_${Date.now()}`,
      name: fileName || "BUKA PHOTO PRO session",
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
    const recipe = LuminaIntent.parse(text);
    if (!recipe) return;

    if (recipe.isRecord) {
      LuminaCamera.open({ onCapture: openFile, toast, record: true });
      intentInput.value = "";
      toast(recipe.toast);
      return;
    }

    if (app.classList.contains("empty")) {
      toast("Open an image first");
      return;
    }

    if (recipe.isAddText) {
      LuminaErase.close();
      LuminaCompose.addTextBox();
      document.getElementById("btnText")?.classList.add("active");
      intentInput.value = "";
      toast(recipe.toast);
      return;
    }

    if (recipe.isImageSize) {
      openSizeDialog("working");
      intentInput.value = "";
      toast(recipe.toast);
      return;
    }

    if (recipe.isStudioDrop) {
      LuminaErase.close();
      LuminaCompose.applyBgMode("studio");
      intentInput.value = "";
      toast(recipe.toast);
      return;
    }

    if (recipe.isTransparentBg) {
      LuminaErase.close();
      LuminaCompose.applyBgMode("transparent");
      intentInput.value = "";
      toast(recipe.toast);
      return;
    }

    if (recipe.isErase) {
      LuminaErase.open();
      if (recipe.eraseSubject) LuminaErase.selectSubject();
      else if (recipe.eraseEntity) LuminaErase.selectEntity(recipe.eraseEntity);
      intentInput.value = "";
      toast(recipe.toast);
      return;
    }

    if (recipe.selectEntity) {
      const entity = LuminaSegment.findByName(LuminaEngine.getEntities(), recipe.selectEntity);
      if (!entity) {
        toast(`No entity matching “${recipe.selectEntity}”`);
        return;
      }
      const bounds = LuminaEngine.entityScreenBounds(entity);
      cancelHudHide();
      LuminaHud.showAdjust(mergedParams(LuminaGraph.getState()));
      LuminaHud.highlightEntity(bounds);
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

  function openProjectsPanel() {
    LuminaStudio.setProjectsOpen(true);
    projectsPanel.hidden = false;
    projectsPanel.dataset.open = "true";
    renderProjects();
  }

  function closeProjectsPanel() {
    LuminaStudio.setProjectsOpen(false);
    projectsPanel.dataset.open = "false";
    projectsPanel.hidden = true;
  }

  function toggleProjectsPanel() {
    if (projectsPanel.dataset.open === "true") closeProjectsPanel();
    else openProjectsPanel();
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
      <div class="project-row" data-id="${p.id}">
        <button type="button" class="project-open" data-id="${p.id}">
          <strong>${escapeHtml(p.name)}</strong>
          <span>${new Date(p.savedAt).toLocaleString()}</span>
        </button>
        <button type="button" class="project-delete" data-id="${p.id}" title="Delete project" aria-label="Delete ${escapeHtml(p.name)}">Delete</button>
      </div>`
      )
      .join("");
    list.querySelectorAll(".project-open").forEach((btn) => {
      btn.addEventListener("click", () => loadProject(btn.dataset.id));
    });
    list.querySelectorAll(".project-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteProject(btn.dataset.id);
      });
    });
  }

  function deleteProject(id) {
    const p = LuminaPersist.get(id);
    if (!p) {
      toast("Project not found");
      return;
    }
    const ok = window.confirm(`Delete project “${p.name}”? This cannot be undone.`);
    if (!ok) return;
    LuminaPersist.remove(id);
    if (sessionId === id) sessionId = `p_${Date.now()}`;
    renderProjects();
    toast(`Deleted “${p.name}”`);
  }

  async function loadProject(id) {
    const p = LuminaPersist.get(id);
    if (!p) {
      toast("Project not found");
      return;
    }
    try {
      await applyProjectData(p);
      closeProjectsPanel();
      toast(`Loaded “${p.name}”`);
    } catch (err) {
      toast(err.message || "Project missing image data — open a file and re-save");
    }
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

  function exportBaseName() {
    const raw = (fileName || "buka-photo").replace(/\.[^.]+$/, "");
    const safe = raw.replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "buka-photo";
    return `${safe}-edited`;
  }

  function printImage() {
    if (!LuminaEngine.hasScene()) {
      toast("Open an image first");
      return;
    }
    const png = LuminaEngine.exportWorkingPng() || LuminaEngine.exportPng();
    if (!png) {
      toast("Nothing to print");
      return;
    }
    const frame = document.getElementById("printFrame") || (() => {
      const f = document.createElement("iframe");
      f.id = "printFrame";
      f.title = "Print";
      f.setAttribute("aria-hidden", "true");
      f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
      document.body.appendChild(f);
      return f;
    })();
    const doc = frame.contentDocument || frame.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><title>BUKA PHOTO PRO — Print</title>
<style>
  @page { margin: 12mm; }
  html, body { margin: 0; background: #fff; }
  img { display: block; max-width: 100%; max-height: 100vh; width: auto; height: auto; margin: 0 auto; }
</style></head><body>
<img id="printImg" src="${png}" alt="Print" />
<script>
  const img = document.getElementById("printImg");
  function go() {
    setTimeout(function () {
      window.focus();
      window.print();
    }, 50);
  }
  if (img.complete) go();
  else img.onload = go;
<\/script>
</body></html>`);
    doc.close();
    toast("Opening print dialog…");
  }

  const SIZE_PRESETS = [
    { id: "current", label: "Current" },
    { id: "source", label: "Original" },
    { id: "3840", label: "4K" },
    { id: "1920", label: "1920" },
    { id: "1280", label: "1280" },
    { id: "960", label: "960" },
    { id: "800", label: "800" },
    { id: "640", label: "640" },
    { id: "50", label: "50%" },
  ];

  let sizeMode = "working";
  let sizeAspect = 1;
  let sizePreset = "current";

  function sizeEls() {
    return {
      overlay: document.getElementById("sizeOverlay"),
      title: document.getElementById("sizeTitle"),
      subtitle: document.getElementById("sizeSubtitle"),
      current: document.getElementById("sizeCurrent"),
      presets: document.getElementById("sizePresets"),
      width: document.getElementById("sizeWidth"),
      height: document.getElementById("sizeHeight"),
      lock: document.getElementById("sizeLock"),
      hint: document.getElementById("sizeHint"),
      apply: document.getElementById("btnSizeApply"),
      formatRow: document.getElementById("sizeFormatRow"),
    };
  }

  function scenePixelSize() {
    const scene = LuminaEngine.getScene();
    if (!scene) return null;
    const src = scene.source;
    return {
      w: scene.working.w,
      h: scene.working.h,
      srcW: src?.naturalWidth || src?.width || scene.working.w,
      srcH: src?.naturalHeight || src?.height || scene.working.h,
    };
  }

  function longEdgeSize(long, aspect) {
    const w = aspect >= 1 ? long : Math.max(32, Math.round(long * aspect));
    const h = aspect >= 1 ? Math.max(32, Math.round(long / aspect)) : long;
    return { w, h };
  }

  function setSizeFields(w, h, presetId) {
    const el = sizeEls();
    if (el.width) el.width.value = String(Math.round(w));
    if (el.height) el.height.value = String(Math.round(h));
    if (presetId) sizePreset = presetId;
    el.presets?.querySelectorAll(".size-preset").forEach((b) => {
      b.classList.toggle("active", b.dataset.id === sizePreset);
    });
    if (el.hint) {
      const cur = scenePixelSize();
      el.hint.textContent =
        cur && (w > cur.w + 1 || h > cur.h + 1)
          ? "Larger than the working image — pixels will be scaled up"
          : "";
    }
  }

  function applySizePreset(id) {
    const cur = scenePixelSize();
    if (!cur) return;
    sizePreset = id;
    if (id === "current") return setSizeFields(cur.w, cur.h, id);
    if (id === "source") return setSizeFields(cur.srcW, cur.srcH, id);
    if (id === "50") {
      return setSizeFields(Math.max(32, Math.round(cur.w / 2)), Math.max(32, Math.round(cur.h / 2)), id);
    }
    const long = Number(id);
    if (long) {
      const next = longEdgeSize(long, sizeAspect);
      return setSizeFields(next.w, next.h, id);
    }
  }

  function readSizeFields() {
    const el = sizeEls();
    let w = Number(el.width?.value);
    let h = Number(el.height?.value);
    if (!Number.isFinite(w) || w < 32) w = 32;
    if (!Number.isFinite(h) || h < 32) h = 32;
    w = Math.min(8192, Math.round(w));
    h = Math.min(8192, Math.round(h));
    return { w, h };
  }

  function closeSizeDialog() {
    const { overlay } = sizeEls();
    if (overlay) overlay.hidden = true;
  }

  function openSizeDialog(mode = "working") {
    if (!LuminaEngine.hasScene()) {
      toast("Open an image first");
      return;
    }
    const cur = scenePixelSize();
    if (!cur) return;
    sizeMode = mode;
    sizeAspect = cur.w / cur.h;
    sizePreset = "current";
    const el = sizeEls();
    if (!el.overlay) return;
    if (el.title) el.title.textContent = mode === "export" ? "Export image" : "Image size";
    if (el.subtitle) {
      el.subtitle.textContent =
        mode === "export" ? "Optional resize before saving" : "Change the working pixel size";
    }
    if (el.current) {
      const src =
        cur.srcW !== cur.w || cur.srcH !== cur.h ? ` · original file ${cur.srcW}×${cur.srcH}` : "";
      el.current.textContent = `Working image ${cur.w}×${cur.h}${src}`;
    }
    if (el.apply) el.apply.textContent = mode === "export" ? "Save…" : "Apply";
    if (el.formatRow) {
      const alpha = LuminaCompose.isTransparent?.();
      el.formatRow.hidden = mode !== "export";
      const jpeg = el.formatRow.querySelector('input[value="jpeg"]');
      if (jpeg) jpeg.disabled = !!alpha;
      if (alpha) {
        const png = el.formatRow.querySelector('input[value="png"]');
        if (png) png.checked = true;
      }
    }
    if (el.presets) {
      el.presets.innerHTML = "";
      for (const p of SIZE_PRESETS) {
        if (p.id === "source" && cur.srcW === cur.w && cur.srcH === cur.h) continue;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "size-preset" + (p.id === "current" ? " active" : "");
        b.dataset.id = p.id;
        b.textContent = p.label;
        b.addEventListener("click", () => applySizePreset(p.id));
        el.presets.appendChild(b);
      }
    }
    setSizeFields(cur.w, cur.h, "current");
    el.overlay.hidden = false;
    el.width?.focus();
  }

  function scaleDataUrl(dataUrl, w, h) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth === w && img.naturalHeight === h) {
          resolve(dataUrl);
          return;
        }
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Could not scale image"));
      img.src = dataUrl;
    });
  }

  async function applyWorkingSize(w, h) {
    const png = LuminaEngine.exportWorkingPng() || LuminaEngine.exportPng();
    if (!png) {
      toast("Nothing to resize");
      return;
    }
    toast(`Resizing to ${w}×${h}…`);
    const scaled = await scaleDataUrl(png, w, h);
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Resize failed"));
      el.src = scaled;
    });
    const scene = LuminaEngine.getScene();
    await bootstrapFromImage(img, {
      profile: scene?.profile,
      fromRaw: !!scene?.fromRaw,
      fileName: fileName || scene?.fileName || "resized",
      size: { w, h },
    });
    toast(`Image resized to ${w}×${h}`);
  }

  function selectedExportFormat() {
    const picked = document.querySelector('input[name="sizeFormat"]:checked');
    return picked?.value === "jpeg" ? "jpeg" : "png";
  }

  async function dataUrlAsFormat(dataUrl, format) {
    if (format !== "jpeg") return dataUrl;
    const img = await dataUrlToImage(dataUrl);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    return c.toDataURL("image/jpeg", 0.92);
  }

  async function confirmSizeDialog() {
    const { w, h } = readSizeFields();
    const format = selectedExportFormat();
    closeSizeDialog();
    if (sizeMode === "export") {
      await exportImageAs({ width: w, height: h, format });
      return;
    }
    try {
      await applyWorkingSize(w, h);
    } catch (err) {
      toast(err?.message || "Could not resize image");
    }
  }

  async function exportImageAs(opts = {}) {
    if (!LuminaEngine.hasScene()) {
      toast("Open an image first");
      return null;
    }
    let png = LuminaEngine.exportWorkingPng() || LuminaEngine.exportPng();
    if (!png) {
      toast("Nothing to export");
      return null;
    }
    const cur = scenePixelSize();
    const tw = opts.width;
    const th = opts.height;
    if (tw && th && cur && (tw !== cur.w || th !== cur.h)) {
      try {
        png = await scaleDataUrl(png, tw, th);
      } catch (err) {
        toast(err?.message || "Could not resize export");
        return null;
      }
    }
    const alpha = LuminaCompose.isTransparent?.();
    const studio = LuminaCompose.isStudio?.();
    const format = alpha ? "png" : opts.format || "png";
    const ext = format === "jpeg" ? ".jpg" : ".png";
    const mime = format === "jpeg" ? "image/jpeg" : "image/png";
    let out = png;
    if (format === "jpeg") {
      try {
        out = await dataUrlAsFormat(png, "jpeg");
      } catch (err) {
        toast(err?.message || "Could not encode JPEG");
        return null;
      }
    }
    try {
      const result = await LuminaPersist.saveAs({
        suggestedName: `${exportBaseName()}${alpha ? "-cutout" : studio ? "-studio" : ""}${ext}`,
        dataUrl: out,
        mime,
        description: alpha ? "PNG Image (transparent background)" : studio ? "Studio image" : format === "jpeg" ? "JPEG Image" : "PNG Image",
        extensions: [ext],
      });
      if (result.cancelled) {
        toast("Export cancelled");
        return null;
      }
      toast(
        result.name
          ? `Saved “${result.name}”${alpha ? " — transparent PNG" : studio ? " — studio drop" : ""}`
          : alpha
            ? "Transparent PNG saved"
            : studio
              ? "Studio drop saved"
              : "Image saved"
      );
      return result;
    } catch (err) {
      toast(err.message || "Could not save image");
      return null;
    }
  }

  async function exportAll() {
    if (!LuminaEngine.hasScene()) {
      toast("Open an image first");
      return;
    }
    const base = exportBaseName();
    const png = LuminaEngine.exportWorkingPng() || LuminaEngine.exportPng();
    if (!png) {
      toast("Nothing to export");
      return;
    }

    let pngResult;
    try {
      pngResult = await LuminaPersist.saveAs({
        suggestedName: `${base}.png`,
        dataUrl: png,
        mime: "image/png",
        description: "PNG Image",
        extensions: [".png"],
      });
    } catch (err) {
      toast(err.message || "Could not save image");
      return;
    }
    if (pngResult.cancelled) {
      toast("Export cancelled");
      return;
    }

    const sidecar = LuminaPersist.exportSidecar({
      version: "0.3.0",
      exportedAt: new Date().toISOString(),
      fileName,
      keepExif: LuminaStudio.getKeepExif(),
      profile: LuminaEngine.getScene()?.profile,
      lightField: LuminaEngine.getScene()?.lightField,
      entities: LuminaEngine.getEntities().map((e) => ({ id: e.id, name: e.name, score: e.score })),
      globalParams: LuminaStudio.getKeepExif() ? globalParams : undefined,
      graph: LuminaStudio.getKeepExif() ? LuminaGraph.getState() : undefined,
      faces: LuminaEngine.getScene()?.faces,
    });

    if (!LuminaStudio.getKeepExif()) {
      toast(`Saved “${pngResult.name || `${base}.png`}”`);
      return;
    }
    try {
      const jsonResult = await LuminaPersist.saveAs({
        suggestedName: `${base}.json`,
        text: sidecar,
        mime: "application/json",
        description: "Thought Graph Sidecar",
        extensions: [".json"],
      });
      if (jsonResult.cancelled) {
        toast(`Saved “${pngResult.name || `${base}.png`}” (sidecar skipped)`);
        return;
      }
      toast(`Saved “${pngResult.name || `${base}.png`}” + sidecar`);
    } catch (err) {
      toast(`Image saved; sidecar failed — ${err.message || "error"}`);
    }
  }

  // —— Events ——
  document.getElementById("btnOpen").addEventListener("click", () => fileInput.click());
  document.getElementById("btnCamera")?.addEventListener("click", () => {
    LuminaCamera.open({ onCapture: openFile, toast });
  });
  document.getElementById("btnProjectsEmpty")?.addEventListener("click", () => {
    openProjectsPanel();
  });

  LuminaCamera.init({ onCapture: openFile, toast });
  LuminaCompose.init({ toast });

  LuminaEngine.setOnSourceChange(reEvaluate);
  LuminaErase.init({
    toast,
    onOpen: () => {
      if (paintMode) document.getElementById("btnPaint").click();
      document.getElementById("btnErase")?.classList.add("active");
    },
    onClose: () => document.getElementById("btnErase")?.classList.remove("active"),
    // The fill is baked into the source pixels; the node is the visible record
    // of it in the Thought Graph and what global undo unwinds.
    onErase: () => {
      const state = LuminaGraph.getState();
      LuminaGraph.addNode({
        title: "Erase",
        type: "erase",
        branch: "root",
        parent: LuminaGraph.latest()?.id || "import",
        params: {},
        meta: { source: "erase" },
        x: 20,
        y: 24 + state.nodes.length * 72,
      });
      autoSaveSoft();
    },
    onUndo: () => {
      const state = LuminaGraph.getState();
      if (state.nodes[state.nodes.length - 1]?.type === "erase") LuminaGraph.undo();
      autoSaveSoft();
    },
  });

  document.getElementById("btnErase")?.addEventListener("click", () => LuminaErase.toggle());

  fileInput.addEventListener("change", () => {
    openFile(fileInput.files?.[0]);
    fileInput.value = "";
  });
  document.getElementById("rawInput")?.addEventListener("change", (e) => {
    openFile(e.target.files?.[0]);
    e.target.value = "";
  });
  document.getElementById("projectInput")?.addEventListener("change", (e) => {
    openProjectFile(e.target.files?.[0]);
    e.target.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) => window.addEventListener(evt, (e) => e.preventDefault()));
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (/\.json$/i.test(file.name)) openProjectFile(file);
    else openFile(file);
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
    LuminaStudio.cycleCompare(LuminaStudio.getCompareMode() === "swipe" ? "off" : "swipe");
  });

  document.getElementById("btnPaint").addEventListener("click", () => {
    paintMode = !paintMode;
    document.getElementById("btnPaint").classList.toggle("active", paintMode);
    app.classList.toggle("paint-mode", paintMode);
    toast(paintMode ? "Mask paint on — drag on canvas · Shift erases" : "Mask paint off");
  });

  document.getElementById("btnCompose")?.addEventListener("click", () => {
    if (!LuminaEngine.hasScene()) {
      toast("Open an image first");
      return;
    }
    if (LuminaErase.isActive()) LuminaErase.close();
    LuminaCompose.openPanel();
  });

  document.getElementById("btnText")?.addEventListener("click", () => {
    if (!LuminaEngine.hasScene()) {
      toast("Open an image first");
      return;
    }
    if (LuminaErase.isActive()) LuminaErase.close();
    LuminaCompose.addTextBox();
    document.getElementById("btnText")?.classList.add("active");
  });

  document.getElementById("btnTransparent")?.addEventListener("click", () => {
    if (!LuminaEngine.hasScene()) {
      toast("Open an image first");
      return;
    }
    if (LuminaErase.isActive()) LuminaErase.close();
    LuminaCompose.toggleTransparent();
    if (LuminaCompose.isTransparent()) LuminaCompose.openPanel();
  });

  document.getElementById("btnStudio")?.addEventListener("click", () => {
    if (!LuminaEngine.hasScene()) {
      toast("Open an image first");
      return;
    }
    if (LuminaErase.isActive()) LuminaErase.close();
    LuminaCompose.toggleStudio();
    if (LuminaCompose.isStudio()) LuminaCompose.openPanel();
  });

  document.getElementById("btnUndo").addEventListener("click", () => undoLast());

  document.getElementById("btnSave").addEventListener("click", () => saveProject());

  document.getElementById("btnProjects").addEventListener("click", () => {
    toggleProjectsPanel();
  });
  document.getElementById("btnCloseProjects").addEventListener("click", () => {
    closeProjectsPanel();
  });

  document.getElementById("btnExport").addEventListener("click", () => openSizeDialog("export"));
  document.getElementById("btnSizeClose")?.addEventListener("click", () => closeSizeDialog());
  document.getElementById("btnSizeCancel")?.addEventListener("click", () => closeSizeDialog());
  document.getElementById("btnSizeApply")?.addEventListener("click", () => confirmSizeDialog());
  document.getElementById("sizeOverlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSizeDialog();
  });
  document.getElementById("sizeWidth")?.addEventListener("input", () => {
    sizePreset = "custom";
    const el = sizeEls();
    el.presets?.querySelectorAll(".size-preset").forEach((b) => b.classList.remove("active"));
    if (!el.lock?.checked) return;
    const w = Number(el.width.value);
    if (!Number.isFinite(w) || !sizeAspect) return;
    el.height.value = String(Math.max(32, Math.round(w / sizeAspect)));
  });
  document.getElementById("sizeHeight")?.addEventListener("input", () => {
    sizePreset = "custom";
    const el = sizeEls();
    el.presets?.querySelectorAll(".size-preset").forEach((b) => b.classList.remove("active"));
    if (!el.lock?.checked) return;
    const h = Number(el.height.value);
    if (!Number.isFinite(h) || !sizeAspect) return;
    el.width.value = String(Math.max(32, Math.round(h * sizeAspect)));
  });
  window.addEventListener("keydown", (e) => {
    const overlay = document.getElementById("sizeOverlay");
    if (!overlay || overlay.hidden) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      closeSizeDialog();
    }
    if (e.key === "Enter" && (e.target === sizeEls().width || e.target === sizeEls().height)) {
      e.preventDefault();
      confirmSizeDialog();
    }
  });
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
  const intentDock = document.getElementById("intentDock");
  let hudHideTimer = null;

  function cancelHudHide() {
    clearTimeout(hudHideTimer);
    hudHideTimer = null;
  }

  function scheduleGlowClear() {
    cancelHudHide();
    hudHideTimer = setTimeout(() => LuminaHud.clearGlow(), 450);
  }

  function showEntityHighlight(entity) {
    if (!entity) {
      scheduleGlowClear();
      return;
    }
    cancelHudHide();
    LuminaHud.highlightEntity(LuminaEngine.entityScreenBounds(entity));
  }

  materialHud.addEventListener("pointerenter", cancelHudHide);
  materialHud.addEventListener("pointerleave", (e) => {
    if (canvasZone.contains(e.relatedTarget)) return;
    scheduleGlowClear();
  });

  canvasZone.addEventListener("pointermove", (e) => {
    if (app.classList.contains("empty") || LuminaErase.isActive()) return;

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
    showEntityHighlight(entity);
  });

  canvasZone.addEventListener("pointerdown", (e) => {
    if (paintMode && !LuminaErase.isActive()) {
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
    if (materialHud.contains(e.relatedTarget) || intentDock.contains(e.relatedTarget)) {
      cancelHudHide();
      return;
    }
    if (!paintMode) scheduleGlowClear();
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
      undoLast();
    }
    if (meta && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (e.shiftKey) saveProjectAs();
      else saveProject();
    }
    if (meta && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redoLast();
    }
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
    if (e.key.toLowerCase() === "g") {
      thoughtGraph.dataset.open = thoughtGraph.dataset.open === "true" ? "false" : "true";
    }
    if (e.key.toLowerCase() === "c") {
      document.getElementById("btnCompare").click();
    }
    if (e.key.toLowerCase() === "m") {
      document.getElementById("btnPaint").click();
    }
    if (e.key.toLowerCase() === "e") {
      LuminaErase.toggle();
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
    version: "0.3.0",
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
    exportImageAs,
    exportAll,
    imageSize: () => openSizeDialog("working"),
    resizeImage: (w, h) => applyWorkingSize(w, h),
    saveProject,
    saveProjectAs,
    redo: redoLast,
    openGuide,
    listProjects: () => LuminaPersist.list(),
    deleteProject,
    undo: undoLast,
    blendSelected: () => LuminaGraph.blendSelected(maskConfigFromUI()),
    erase: {
      open: () => LuminaErase.open(),
      close: () => LuminaErase.close(),
      selectSubject: () => LuminaErase.selectSubject(),
      selectEntity: (id) => LuminaErase.selectEntity(id),
      clear: () => LuminaErase.clearSelection(),
      apply: () => LuminaErase.apply(),
      undo: () => LuminaErase.undo(),
      settings: () => LuminaErase.getSettings(),
      configure: (patch) => LuminaErase.setSettings(patch),
      fill: (imageData, mask, opts, onProgress) => LuminaInpaint.fill(imageData, mask, opts, onProgress),
    },
    camera: {
      open: (opts = {}) => LuminaCamera.open({ onCapture: openFile, toast, ...opts }),
      record: () => LuminaCamera.open({ onCapture: openFile, toast, record: true }),
      close: () => LuminaCamera.close(),
    },
    compose: {
      open: () => LuminaCompose.openPanel(),
      transparent: () => LuminaCompose.applyBgMode("transparent"),
      studio: () => LuminaCompose.applyBgMode("studio"),
      resetBackground: () => LuminaCompose.applyBgMode("original"),
      isTransparent: () => LuminaCompose.isTransparent(),
      isStudio: () => LuminaCompose.isStudio(),
    },
    applyTool,
    applyPreset: (id) => {
      const p = LuminaStudio.getPresets().find((x) => x.id === id);
      if (p) applyTool({ id: p.id, label: p.label, type: "adjust", params: p.params });
    },
    registerPlugin: (plugin) => LuminaStudio.registerPlugin(plugin),
    toolsCatalog: () => LuminaToolsMenu.getCatalog(),
    zoomIn: () => LuminaEngine.zoomIn(),
    zoomOut: () => LuminaEngine.zoomOut(),
    zoomFit: () => LuminaEngine.zoomFit(),
    getZoom: () => LuminaEngine.getZoomState(),
  };
})();
