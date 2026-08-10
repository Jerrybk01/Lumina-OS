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

  function download(filename, text, mime = "application/json") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return { list, save, remove, get, exportSidecar, download };
})();
