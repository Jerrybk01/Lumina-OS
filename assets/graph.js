/**
 * Thought Graph — branching history with live DAG recompute.
 */
const LuminaGraph = (() => {
  let nodesEl;
  let edgesEl;
  let nodes = [];
  let edges = [];
  let selected = new Set();
  let activeId = null;
  let onChange = () => {};
  let history = [];

  function init(nodesContainer, edgesSvg, changeCb) {
    nodesEl = nodesContainer;
    edgesEl = edgesSvg;
    onChange = changeCb || (() => {});
  }

  function snapshot() {
    history.push(JSON.stringify({ nodes, edges, activeId }));
    if (history.length > 60) history.shift();
  }

  function undo() {
    if (history.length < 2) return false;
    history.pop();
    const prev = JSON.parse(history[history.length - 1]);
    nodes = prev.nodes;
    edges = prev.edges;
    activeId = prev.activeId;
    selected.clear();
    render();
    emit(true);
    return true;
  }

  function emit(fromUndo = false, doSnapshot = true) {
    if (!fromUndo && doSnapshot) snapshot();
    onChange(getState());
  }

  function updateNodeParams(id, patch, recompute = true) {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    n.params = { ...n.params, ...patch };
    activeId = id;
    render();
    if (recompute) emit(false, false);
  }

  function reset(importMeta = {}) {
    nodes = [];
    edges = [];
    selected.clear();
    history = [];
    const n = addNode(
      {
        id: "import",
        title: "Import",
        type: "ingest",
        branch: "root",
        x: 20,
        y: 24,
        params: {},
        meta: importMeta,
      },
      true
    );
    activeId = n.id;
    history = [];
    snapshot();
    render();
    onChange(getState());
    return n;
  }

  function addNode(partial, silent = false) {
    const node = {
      id: partial.id || `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: partial.title || "Node",
      type: partial.type || "op",
      branch: partial.branch || "root",
      x: partial.x ?? 20,
      y: partial.y ?? 24 + nodes.length * 72,
      params: { ...(partial.params || {}) },
      meta: { ...(partial.meta || {}) },
    };
    nodes.push(node);
    if (partial.parent) edges.push({ from: partial.parent, to: node.id });
    if (partial.parents) {
      for (const p of partial.parents) edges.push({ from: p, to: node.id });
    }
    activeId = node.id;
    render();
    if (!silent) emit();
    else onChange(getState());
    return node;
  }

  function setActive(id) {
    activeId = id;
    render();
    onChange(getState());
  }

  function connect(from, to) {
    if (!edges.some((e) => e.from === from && e.to === to)) {
      edges.push({ from, to });
      render();
      emit();
    }
  }

  function latest() {
    return nodes[nodes.length - 1] || null;
  }

  function getState() {
    return {
      nodes: nodes.map((n) => ({ ...n, params: { ...n.params }, meta: { ...n.meta } })),
      edges: edges.map((e) => ({ ...e })),
      selected: [...selected],
      activeId,
    };
  }

  function loadState(state) {
    nodes = (state.nodes || []).map((n) => ({ ...n, params: { ...n.params }, meta: { ...n.meta } }));
    edges = (state.edges || []).map((e) => ({ ...e }));
    activeId = state.activeId || nodes[nodes.length - 1]?.id || null;
    selected.clear();
    history = [];
    snapshot();
    render();
    onChange(getState());
  }

  function toggleSelect(id) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    activeId = id;
    render();
    onChange(getState());
  }

  function blendSelected(maskConfig) {
    const ids = [...selected];
    if (ids.length < 2) return null;
    const blend = addNode({
      title: "Blend",
      type: "blend",
      branch: "merge",
      x: 90,
      y: 24 + nodes.length * 72,
      parents: ids.slice(0, 2),
      params: {},
      meta: {
        mask: maskConfig || {
          sky: "b",
          mountains: "a",
          foreground: "a",
          label: "Sky←Sunset · Mountains/FG←Day",
        },
      },
    });
    selected.clear();
    render();
    return blend;
  }

  function render() {
    if (!nodesEl || !edgesEl) return;
    nodesEl.innerHTML = "";
    const maxY = Math.max(280, ...nodes.map((n) => n.y + 90));
    nodesEl.style.minHeight = `${maxY}px`;
    edgesEl.style.height = `${maxY}px`;
    edgesEl.setAttribute("viewBox", `0 0 320 ${maxY}`);
    edgesEl.innerHTML = "";

    for (const e of edges) {
      const a = nodes.find((n) => n.id === e.from);
      const b = nodes.find((n) => n.id === e.to);
      if (!a || !b) continue;
      const x1 = a.x + 74;
      const y1 = a.y + 36;
      const x2 = b.x + 74;
      const y2 = b.y + 8;
      const mid = (y1 + y2) / 2;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "rgba(126,200,200,0.35)");
      path.setAttribute("stroke-width", "1.5");
      edgesEl.appendChild(path);
    }

    for (const n of nodes) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `graph-node branch-${n.branch === "dr" ? "a" : n.branch === "light" ? "b" : n.branch === "merge" ? "b" : "root"}`;
      if (selected.has(n.id)) el.classList.add("selected");
      if (n.id === activeId) el.classList.add("active-node");
      el.style.left = `${n.x}px`;
      el.style.top = `${n.y}px`;
      el.innerHTML = `<div class="node-type">${esc(n.type)}</div><div class="node-title">${esc(n.title)}</div>`;
      el.title = "Click select · Double-click set active leaf";
      el.addEventListener("click", (ev) => {
        if (ev.detail === 2) setActive(n.id);
        else toggleSelect(n.id);
      });
      nodesEl.appendChild(el);
    }
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return {
    init,
    reset,
    addNode,
    updateNodeParams,
    setActive,
    connect,
    latest,
    getState,
    loadState,
    blendSelected,
    undo,
    render,
  };
})();
