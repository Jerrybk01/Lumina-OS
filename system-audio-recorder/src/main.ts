import "./styles.css";
import { api, type LiveSnapshot, type RecordSettings, type SessionStats } from "./api";

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="logo" aria-hidden="true"></div>
        <div>
          <h1>Buka Quality Sound</h1>
          <p>System / loopback audio recorder</p>
        </div>
      </div>
      <div class="top-actions">
        <button class="icon-btn" id="themeBtn" type="button" title="Toggle theme">Theme</button>
      </div>
    </header>

    <main class="stage">
      <section class="transport">
        <div class="timer-block">
          <div class="timer" id="timer">00:00:00.0</div>
          <div class="meta" id="fileMeta">Ready · 0 B</div>
        </div>
        <div class="controls">
          <button class="btn btn-secondary" id="pauseBtn" type="button" disabled>Pause <span class="kbd">P</span></button>
          <button class="btn btn-record" id="recordBtn" type="button">Rec <span class="kbd">R</span></button>
          <button class="btn btn-secondary" id="stopBtn" type="button" disabled>Stop <span class="kbd">S</span></button>
        </div>
        <div class="status-chip"><span class="dot" id="statusDot"></span><span id="statusText">Idle</span></div>
      </section>

      <section class="viz" aria-label="Waveform and meters">
        <div class="wave-wrap">
          <canvas id="waveform" width="860" height="180"></canvas>
          <div class="clip-banner" id="clipBanner">CLIPPING</div>
        </div>
        <div class="meters">
          <div class="meter">
            <span>L</span>
            <div class="meter-track">
              <div class="meter-fill" id="meterL"></div>
              <div class="meter-peak" id="peakL"></div>
            </div>
          </div>
          <div class="meter">
            <span>R</span>
            <div class="meter-track">
              <div class="meter-fill" id="meterR"></div>
              <div class="meter-peak" id="peakR"></div>
            </div>
          </div>
        </div>
      </section>

      <section class="settings">
        <div class="field">
          <label for="device">Loopback device</label>
          <select id="device"></select>
        </div>
        <div class="field">
          <label for="appSource">Per-app source</label>
          <select id="appSource"></select>
        </div>
        <div class="field">
          <label for="sampleRate">Sample rate</label>
          <select id="sampleRate">
            <option value="hz48000">48 kHz</option>
            <option value="hz44100">44.1 kHz</option>
          </select>
        </div>
        <div class="field">
          <label for="format">Export format</label>
          <select id="format">
            <option value="wav">WAV (24-bit)</option>
            <option value="mp3">MP3 (320 kbps)</option>
          </select>
        </div>
        <div class="field" style="grid-column: span 2;">
          <label for="outputDir">Save folder</label>
          <div class="field-row">
            <input id="outputDir" type="text" readonly placeholder="Choose a folder…" />
            <button class="icon-btn" id="browseBtn" type="button">Browse</button>
          </div>
        </div>
        <div class="toggles" style="grid-column: 1 / -1;">
          <label class="toggle"><input type="checkbox" id="noiseReduction" /> Noise reduction</label>
          <label class="toggle"><input type="checkbox" id="autoSplit" /> Auto-split on silence</label>
        </div>
      </section>
    </main>

    <footer class="footer">
      <div id="capsNote">Loading capture backend…</div>
      <div>Hotkeys: <span class="kbd">R</span> record · <span class="kbd">P</span> pause · <span class="kbd">S</span> stop</div>
    </footer>
  </div>
  <div class="error-toast" id="toast"></div>
`;

const els = {
  themeBtn: $("#themeBtn"),
  timer: $("#timer"),
  fileMeta: $("#fileMeta"),
  pauseBtn: $("#pauseBtn") as HTMLButtonElement,
  recordBtn: $("#recordBtn") as HTMLButtonElement,
  stopBtn: $("#stopBtn") as HTMLButtonElement,
  statusDot: $("#statusDot"),
  statusText: $("#statusText"),
  waveform: $("#waveform") as HTMLCanvasElement,
  clipBanner: $("#clipBanner"),
  meterL: $("#meterL"),
  meterR: $("#meterR"),
  peakL: $("#peakL"),
  peakR: $("#peakR"),
  device: $("#device") as HTMLSelectElement,
  appSource: $("#appSource") as HTMLSelectElement,
  sampleRate: $("#sampleRate") as HTMLSelectElement,
  format: $("#format") as HTMLSelectElement,
  outputDir: $("#outputDir") as HTMLInputElement,
  browseBtn: $("#browseBtn"),
  noiseReduction: $("#noiseReduction") as HTMLInputElement,
  autoSplit: $("#autoSplit") as HTMLInputElement,
  capsNote: $("#capsNote"),
  toast: $("#toast"),
};

function $(sel: string): HTMLElement {
  return document.querySelector(sel)!;
}

let settings: RecordSettings;
let polling = false;
let waveHistory: number[] = Array(128).fill(0);
let clipFlashUntil = 0;

function formatTime(ms: number): string {
  const total = Math.floor(ms / 100);
  const tenths = total % 10;
  const secs = Math.floor(total / 10) % 60;
  const mins = Math.floor(total / 600) % 60;
  const hours = Math.floor(total / 36000);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${p(hours)}:${p(mins)}:${p(secs)}.${tenths}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function showError(msg: string) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  window.setTimeout(() => els.toast.classList.remove("show"), 4200);
}

function applyTheme(theme: "dark" | "light") {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("buka-theme", theme);
  els.themeBtn.textContent = theme === "dark" ? "Light" : "Dark";
}

function readSettingsFromUi(): RecordSettings {
  return {
    ...settings,
    sample_rate: els.sampleRate.value as RecordSettings["sample_rate"],
    format: els.format.value as RecordSettings["format"],
    output_dir: els.outputDir.value,
    device_id: els.device.value || null,
    app_source_id: els.appSource.value || null,
    noise_reduction: els.noiseReduction.checked,
    auto_split: els.autoSplit.checked,
  };
}

async function persistSettings() {
  settings = readSettingsFromUi();
  try {
    await api.updateSettings(settings);
  } catch (e) {
    showError(String(e));
  }
}

function updateTransport(stats: SessionStats) {
  els.timer.textContent = formatTime(stats.elapsed_ms);
  const path = stats.file_path ? stats.file_path.split(/[\\/]/).pop() : "—";
  els.fileMeta.textContent = `${path} · ${formatBytes(stats.bytes_written)}${
    stats.segment_index > 0 ? ` · seg ${stats.segment_index}` : ""
  }`;

  const recording = stats.state === "recording";
  const paused = stats.state === "paused";
  const active = recording || paused;

  els.recordBtn.disabled = active;
  els.pauseBtn.disabled = !active;
  els.stopBtn.disabled = !active;
  els.recordBtn.classList.toggle("recording", recording);
  els.pauseBtn.textContent = paused
    ? `Resume `
    : `Pause `;
  // re-append kbd hint
  els.pauseBtn.innerHTML = paused
    ? `Resume <span class="kbd">P</span>`
    : `Pause <span class="kbd">P</span>`;

  els.statusDot.className = "dot" + (recording ? " live" : paused ? " paused" : "");
  els.statusText.textContent =
    recording ? "Recording" : paused ? "Paused" : "Idle";

  const locked = active;
  [
    els.device,
    els.appSource,
    els.sampleRate,
    els.format,
    els.browseBtn,
    els.noiseReduction,
    els.autoSplit,
  ].forEach((el) => {
    (el as HTMLButtonElement | HTMLSelectElement | HTMLInputElement).disabled = locked;
  });
}

function drawWaveform(values: number[]) {
  const canvas = els.waveform;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 860;
  const cssH = canvas.clientHeight || 180;
  if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const mid = cssH / 2;
  const theme = document.documentElement.getAttribute("data-theme");
  ctx.strokeStyle = theme === "light" ? "rgba(15,32,51,0.08)" : "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(cssW, mid);
  ctx.stroke();

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const grad = ctx.createLinearGradient(0, 0, cssW, 0);
  grad.addColorStop(0, accent);
  grad.addColorStop(1, "#4f8cff");
  ctx.fillStyle = grad;
  ctx.globalAlpha = 0.9;

  const n = values.length;
  const barW = cssW / n;
  for (let i = 0; i < n; i++) {
    const mag = Math.max(0.02, values[i]);
    const h = mag * (cssH * 0.42);
    const x = i * barW;
    ctx.fillRect(x + 1, mid - h, Math.max(1, barW - 2), h);
    ctx.fillRect(x + 1, mid, Math.max(1, barW - 2), h);
  }
  ctx.globalAlpha = 1;
}

function updateMeters(live: LiveSnapshot) {
  const set = (fill: HTMLElement, peak: HTMLElement, v: number, p: number) => {
    const h = Math.min(100, v * 100);
    const ph = Math.min(100, p * 100);
    fill.style.height = `${h}%`;
    peak.style.bottom = `${ph}%`;
  };
  set(els.meterL, els.peakL, live.meter.rms_l, live.meter.peak_l);
  set(els.meterR, els.peakR, live.meter.rms_r, live.meter.peak_r);

  waveHistory = live.meter.waveform;
  drawWaveform(waveHistory);

  if (live.meter.clipping || live.stats.clipping) {
    clipFlashUntil = performance.now() + 1200;
  }
  els.clipBanner.classList.toggle("show", performance.now() < clipFlashUntil);
}

async function tick() {
  if (polling) return;
  polling = true;
  try {
    const live = await api.pollLive();
    updateTransport(live.stats);
    updateMeters(live);
    if (live.stats.error) showError(live.stats.error);
  } catch (e) {
    showError(String(e));
  } finally {
    polling = false;
  }
}

async function startRecording() {
  try {
    await persistSettings();
    const stats = await api.start();
    updateTransport(stats);
  } catch (e) {
    showError(String(e));
  }
}

async function pauseRecording() {
  try {
    const stats = await api.pause();
    updateTransport(stats);
  } catch (e) {
    showError(String(e));
  }
}

async function stopRecording() {
  try {
    const stats = await api.stop();
    updateTransport(stats);
  } catch (e) {
    showError(String(e));
  }
}

async function init() {
  const saved = localStorage.getItem("buka-theme");
  applyTheme(saved === "light" ? "light" : "dark");

  const [caps, devices, apps, defaults, outDir] = await Promise.all([
    api.getCapabilities(),
    api.listDevices(),
    api.listAppSources(),
    api.getSettings(),
    api.defaultOutputDir(),
  ]);

  settings = { ...defaults, output_dir: defaults.output_dir || outDir };
  els.capsNote.textContent = `${caps.platform}: ${caps.loopback_backend}. ${caps.notes}`;

  els.device.innerHTML = devices
    .map(
      (d) =>
        `<option value="${d.id}" ${d.is_default ? "selected" : ""}>${escapeHtml(d.name)}</option>`,
    )
    .join("");

  els.appSource.innerHTML = apps
    .map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`)
    .join("");
  if (!caps.per_app_selection) {
    els.appSource.disabled = true;
    els.appSource.title = "Per-app selection is limited on this platform";
  }

  els.sampleRate.value = settings.sample_rate;
  els.format.value = settings.format;
  els.outputDir.value = settings.output_dir;
  els.noiseReduction.checked = settings.noise_reduction;
  els.autoSplit.checked = settings.auto_split;
  if (settings.device_id) els.device.value = settings.device_id;
  if (settings.app_source_id) els.appSource.value = settings.app_source_id;

  await persistSettings();
  drawWaveform(waveHistory);
  window.setInterval(tick, 50);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

els.themeBtn.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  applyTheme(cur === "dark" ? "light" : "dark");
  drawWaveform(waveHistory);
});

els.recordBtn.addEventListener("click", () => void startRecording());
els.pauseBtn.addEventListener("click", () => void pauseRecording());
els.stopBtn.addEventListener("click", () => void stopRecording());
els.browseBtn.addEventListener("click", async () => {
  const folder = await api.pickFolder();
  if (folder) {
    els.outputDir.value = folder;
    await persistSettings();
  }
});

["change", "input"].forEach((ev) => {
  [els.device, els.appSource, els.sampleRate, els.format, els.noiseReduction, els.autoSplit].forEach(
    (el) => el.addEventListener(ev, () => void persistSettings()),
  );
});

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const k = e.key.toLowerCase();
  if (k === "r") {
    e.preventDefault();
    void startRecording();
  } else if (k === "p") {
    e.preventDefault();
    void pauseRecording();
  } else if (k === "s") {
    e.preventDefault();
    void stopRecording();
  }
});

window.addEventListener("resize", () => drawWaveform(waveHistory));

init().catch((e) => showError(String(e)));
