/**
 * Zone B — Adaptive Material HUD (landscape + portrait).
 */
const LuminaHud = (() => {
  let root;
  let contextEl;
  let entityEl;
  let controlsEl;
  let glowEl;
  let onParam = () => {};
  let active = null;

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
  }

  function hide() {
    active = null;
    root.hidden = true;
    root.classList.remove("visible");
    glowEl.classList.remove("active");
    glowEl.hidden = true;
  }

  function show(entity, bounds, params) {
    if (!entity) {
      hide();
      return;
    }

    const same = active && active.id === entity.id;
    active = entity;

    if (!same) {
      contextEl.textContent = entity.context;
      entityEl.textContent = entity.name;
      controlsEl.innerHTML = "";

      for (const control of entity.controls) {
        const wrap = document.createElement("div");
        wrap.className = "hud-dial";
        const value = params[control.key] ?? 0.5;
        const display = control.max > 1 ? Math.round(value) : Math.round(value * 100);
        wrap.innerHTML = `
          <label>
            <span>${control.label}</span>
            <span data-val>${display}</span>
          </label>
          <input type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${value}" data-key="${control.key}" />
        `;
        const input = wrap.querySelector("input");
        const valEl = wrap.querySelector("[data-val]");
        input.addEventListener("input", () => {
          const v = Number(input.value);
          valEl.textContent = String(control.max > 1 ? Math.round(v) : Math.round(v * 100));
          onParam({ [control.key]: v }, entity);
        });
        controlsEl.appendChild(wrap);
      }
    }

    root.hidden = false;
    root.style.left = `${bounds.x}px`;
    root.style.top = `${Math.max(80, bounds.y)}px`;
    requestAnimationFrame(() => root.classList.add("visible"));

    glowEl.hidden = false;
    glowEl.style.left = `${bounds.left}px`;
    glowEl.style.top = `${bounds.top}px`;
    glowEl.style.width = `${Math.max(40, bounds.right - bounds.left)}px`;
    glowEl.style.height = `${Math.max(40, bounds.bottom - bounds.top)}px`;
    glowEl.classList.add("active");
  }

  function getActive() {
    return active;
  }

  return { init, show, hide, getActive };
})();
