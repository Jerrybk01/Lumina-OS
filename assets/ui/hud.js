/**
 * Zone B — Adjustments side panel (editing tools on the right).
 * Entity hover only drives the soft selection glow on the canvas.
 */
const LuminaHud = (() => {
  const ADJUST_CONTROLS = [
    { key: "exposure", label: "Exposure", min: -1, max: 1, step: 0.01 },
    { key: "contrast", label: "Contrast", min: -1, max: 1, step: 0.01 },
    { key: "highlights", label: "Highlights", min: -1, max: 1, step: 0.01 },
    { key: "shadows", label: "Shadows", min: -1, max: 1, step: 0.01 },
    { key: "whites", label: "Whites", min: -1, max: 1, step: 0.01 },
    { key: "blacks", label: "Blacks", min: -1, max: 1, step: 0.01 },
    { key: "temperature", label: "Temperature", min: -1, max: 1, step: 0.01 },
    { key: "tint", label: "Tint", min: -1, max: 1, step: 0.01 },
    { key: "vibrance", label: "Vibrance", min: -1, max: 1, step: 0.01 },
    { key: "saturation", label: "Saturation", min: -1, max: 1, step: 0.01 },
    { key: "clarity", label: "Clarity", min: -1, max: 1, step: 0.01 },
    { key: "dehaze", label: "Dehaze", min: 0, max: 1, step: 0.01 },
    { key: "sharpen", label: "Sharpen", min: 0, max: 1, step: 0.01 },
    { key: "vignette", label: "Vignette", min: 0, max: 1, step: 0.01 },
  ];

  let root;
  let contextEl;
  let entityEl;
  let controlsEl;
  let glowEl;
  let onParam = () => {};
  let built = false;
  let inputsByKey = new Map();

  let focusedKey = null;

  function init(hudRoot, options = {}) {
    root = hudRoot;
    contextEl = document.getElementById("hudContext");
    entityEl = document.getElementById("hudEntity");
    controlsEl = document.getElementById("hudControls");
    onParam = options.onParam || (() => {});
    glowEl = document.createElement("div");
    glowEl.className = "entity-glow";
    glowEl.hidden = true;
    document.getElementById("canvasZone").appendChild(glowEl);

    document.getElementById("btnCloseHud")?.addEventListener("click", () => hide());

    window.addEventListener("keydown", (e) => {
      if (root.hidden || !built) return;
      if (e.target?.matches?.("input[type=text], textarea")) return;
      if (e.key.toLowerCase() === "r" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        resetAll();
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (!focusedKey || !inputsByKey.has(focusedKey)) {
        focusedKey = ADJUST_CONTROLS[0].key;
      }
      const slot = inputsByKey.get(focusedKey);
      if (!slot) return;
      e.preventDefault();
      const step = Number(slot.control.step) * (e.shiftKey ? 5 : 1);
      const dir = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 1;
      let v = Number(slot.input.value) + dir * step;
      v = Math.min(slot.control.max, Math.max(slot.control.min, v));
      slot.input.value = String(v);
      slot.valEl.textContent = String(formatDisplay(slot.control, v));
      onParam({ [focusedKey]: v }, { id: "global", name: "Adjust", context: "Adjust" });
    });
  }

  function resetAll() {
    const patch = {};
    for (const c of ADJUST_CONTROLS) {
      const zero = c.min < 0 ? 0 : c.min;
      patch[c.key] = zero;
      const slot = inputsByKey.get(c.key);
      if (slot) {
        slot.input.value = String(zero);
        slot.valEl.textContent = String(formatDisplay(c, zero));
      }
    }
    onParam(patch, { id: "global", name: "Adjust", context: "Adjust" });
  }

  function hide() {
    root.hidden = true;
    root.classList.remove("visible");
    clearGlow();
  }

  function clearGlow() {
    glowEl.classList.remove("active");
    glowEl.hidden = true;
  }

  function setGlow(bounds) {
    if (!bounds) {
      clearGlow();
      return;
    }
    glowEl.hidden = false;
    glowEl.style.left = `${bounds.left}px`;
    glowEl.style.top = `${bounds.top}px`;
    glowEl.style.width = `${Math.max(40, bounds.right - bounds.left)}px`;
    glowEl.style.height = `${Math.max(40, bounds.bottom - bounds.top)}px`;
    glowEl.classList.add("active");
  }

  function formatDisplay(control, value) {
    if (control.max > 1) return Math.round(value);
    // Signed adjustments centered at 0 read better as −50…50
    if (control.min < 0) return Math.round(value * 100);
    return Math.round(value * 100);
  }

  function buildControls(params) {
    contextEl.textContent = "Adjust";
    entityEl.textContent = "Editing tools";
    controlsEl.innerHTML = "";
    inputsByKey = new Map();

    for (const control of ADJUST_CONTROLS) {
      const wrap = document.createElement("div");
      wrap.className = "hud-dial";
      const value = params[control.key] ?? 0;
      wrap.innerHTML = `
        <label>
          <span>${control.label}</span>
          <span data-val>${formatDisplay(control, value)}</span>
        </label>
        <input type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${value}" data-key="${control.key}" />
      `;
        const input = wrap.querySelector("input");
        const valEl = wrap.querySelector("[data-val]");
        input.addEventListener("focus", () => {
          focusedKey = control.key;
        });
        input.addEventListener("pointerdown", () => {
          focusedKey = control.key;
        });
        input.addEventListener("input", () => {
          focusedKey = control.key;
          const v = Number(input.value);
          valEl.textContent = String(formatDisplay(control, v));
          onParam({ [control.key]: v }, { id: "global", name: "Adjust", context: "Adjust" });
        });
        controlsEl.appendChild(wrap);
        inputsByKey.set(control.key, { input, valEl, control });
      }
    built = true;
  }

  function syncValues(params) {
    if (!built) return;
    for (const [key, slot] of inputsByKey) {
      if (!(key in params)) continue;
      const v = params[key];
      if (Number(slot.input.value) === v) continue;
      slot.input.value = String(v);
      slot.valEl.textContent = String(formatDisplay(slot.control, v));
    }
  }

  /** Open the editing-tools inspector (not entity material dials). */
  function showAdjust(params = {}) {
    if (!built) buildControls(params);
    else syncValues(params);
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add("visible"));
  }

  /** Keep glow for region hover; do not swap inspector to Foreground/Terrain. */
  function highlightEntity(bounds) {
    setGlow(bounds);
  }

  function getActive() {
    return built && !root.hidden ? { id: "global", name: "Adjust", context: "Adjust" } : null;
  }

  function getControls() {
    return ADJUST_CONTROLS.slice();
  }

  return { init, hide, showAdjust, highlightEntity, clearGlow, syncValues, getActive, getControls, resetAll };
})();
