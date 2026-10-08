/**
 * Project persistence (localStorage) + export sidecar.
 */
const LuminaPersist = (() => {
  const KEY = "lumina-os-projects-v1";

  function list() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch {
      return [];
    }
  }

  function save(project) {
    const all = list().filter((p) => p.id !== project.id);
    all.unshift(project);
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 20)));
  }

  function remove(id) {
    localStorage.setItem(KEY, JSON.stringify(list().filter((p) => p.id !== id)));
  }

  function get(id) {
    return list().find((p) => p.id === id) || null;
  }

  function exportSidecar(payload) {
    return JSON.stringify(payload, null, 2);
  }

  function download(filename, data, mime = "application/json") {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function dataUrlToBlob(dataUrl) {
    return (await fetch(dataUrl)).blob();
  }

  /**
   * Save a file to a user-chosen location (Save As).
   * Uses the File System Access API when available; otherwise triggers a download.
   * Returns { ok, name, cancelled } — cancelled when the user dismisses the picker.
   */
  async function saveAs({ suggestedName, blob, dataUrl, text, mime, description, extensions }) {
    let body = blob;
    if (!body && dataUrl) body = await dataUrlToBlob(dataUrl);
    if (!body && text != null) body = new Blob([text], { type: mime || "text/plain" });
    if (!body) throw new Error("Nothing to save");

    const typeMime = mime || body.type || "application/octet-stream";
    const exts = extensions || [];

    if (typeof window.showSaveFilePicker === "function") {
      try {
        const types = exts.length
          ? [{
              description: description || "File",
              accept: { [typeMime]: exts.map((e) => (e.startsWith(".") ? e : `.${e}`)) },
            }]
          : undefined;
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types,
        });
        const writable = await handle.createWritable();
        await writable.write(body);
        await writable.close();
        return { ok: true, name: handle.name, cancelled: false, handle };
      } catch (err) {
        if (err && (err.name === "AbortError" || err.name === "NotAllowedError")) {
          return { ok: false, name: null, cancelled: true, handle: null };
        }
        throw err;
      }
    }

    download(suggestedName, body, typeMime);
    return { ok: true, name: suggestedName, cancelled: false, handle: null };
  }

  async function writeHandle(handle, body) {
    const writable = await handle.createWritable();
    await writable.write(body);
    await writable.close();
    return { ok: true, name: handle.name, cancelled: false, handle };
  }

  /**
   * Save a project JSON to a chosen file. Reuses `handle` when the user already
   * picked a location (Save vs Save As).
   */
  async function saveProjectFile({ project, suggestedName, handle }) {
    const text = JSON.stringify(project);
    const body = new Blob([text], { type: "application/json" });
    if (handle) {
      try {
        return await writeHandle(handle, body);
      } catch (err) {
        if (err && (err.name === "AbortError" || err.name === "NotAllowedError")) {
          return { ok: false, name: null, cancelled: true, handle: null };
        }
      }
    }
    return saveAs({
      suggestedName: suggestedName || "project.buka.json",
      blob: body,
      mime: "application/json",
      description: "BUKA PHOTO PRO Project",
      extensions: [".buka.json", ".json"],
    });
  }

  async function readProjectText(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") throw new Error("Not a project file");
    return data;
  }

  return {
    list,
    save,
    remove,
    get,
    exportSidecar,
    download,
    dataUrlToBlob,
    saveAs,
    saveProjectFile,
    readProjectText,
    writeHandle,
  };
})();
