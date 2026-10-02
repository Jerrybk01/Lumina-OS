/** Thin Tauri IPC wrapper with browser-demo fallbacks for UI development. */

export type SampleRate = "hz44100" | "hz48000";
export type ExportFormat = "wav" | "mp3";
export type RecorderState = "idle" | "recording" | "paused";

export interface AudioDeviceInfo {
  id: string;
  name: string;
  is_loopback: boolean;
  is_default: boolean;
  sample_rates: number[];
  channels: number;
}

export interface AppAudioSource {
  id: string;
  name: string;
  pid: number | null;
}

export interface CaptureCapabilities {
  platform: string;
  loopback_backend: string;
  per_app_selection: boolean;
  notes: string;
}

export interface MeterSnapshot {
  peak_l: number;
  peak_r: number;
  rms_l: number;
  rms_r: number;
  waveform: number[];
  clipping: boolean;
  clip_count: number;
}

export interface SessionStats {
  state: RecorderState;
  elapsed_ms: number;
  bytes_written: number;
  file_path: string | null;
  segment_index: number;
  sample_rate: number;
  format: ExportFormat;
  clipping: boolean;
  clip_count: number;
  error: string | null;
}

export interface RecordSettings {
  sample_rate: SampleRate;
  format: ExportFormat;
  output_dir: string;
  device_id: string | null;
  app_source_id: string | null;
  noise_reduction: boolean;
  auto_split: boolean;
  silence_threshold_db: number;
  silence_duration_ms: number;
  mp3_bitrate_kbps: number;
}

export interface LiveSnapshot {
  meter: MeterSnapshot;
  stats: SessionStats;
}

const isTauri = () =>
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    return demoInvoke<T>(cmd, args);
  }
  const { invoke: inv } = await import("@tauri-apps/api/core");
  return inv<T>(cmd, args);
}

/* ---------- Demo mode (browser / UI mock without native backends) ---------- */

let demoState: RecorderState = "idle";
let demoStarted = 0;
let demoElapsedBefore = 0;
let demoBytes = 0;
let demoClips = 0;
let demoPhase = 0;
let demoSettings: RecordSettings = {
  sample_rate: "hz48000",
  format: "wav",
  output_dir: "/home/user/Music/Buka Quality Sound",
  device_id: "demo",
  app_source_id: "system",
  noise_reduction: false,
  auto_split: false,
  silence_threshold_db: -48,
  silence_duration_ms: 1500,
  mp3_bitrate_kbps: 320,
};

function demoInvoke<T>(cmd: string, args?: Record<string, unknown>): T {
  switch (cmd) {
    case "get_capabilities":
      return {
        platform: "demo",
        loopback_backend: "Browser demo (no native loopback)",
        per_app_selection: false,
        notes: "UI-only demo. Real loopback requires `npm run tauri:dev` (WASAPI / ScreenCaptureKit / Pulse).",
      } as T;
    case "list_devices":
      return [
        {
          id: "demo",
          name: "System Output (Demo Loopback)",
          is_loopback: true,
          is_default: true,
          sample_rates: [44100, 48000],
          channels: 2,
        },
      ] as T;
    case "list_app_sources":
      return [
        { id: "system", name: "All system audio", pid: null },
        { id: "spotify", name: "Spotify", pid: 1204 },
        { id: "chrome", name: "Google Chrome", pid: 884 },
      ] as T;
    case "get_settings":
      return demoSettings as T;
    case "update_settings":
      demoSettings = args?.settings as RecordSettings;
      return undefined as T;
    case "default_output_dir":
      return demoSettings.output_dir as T;
    case "start_recording":
      if (!demoSettings.output_dir) throw new Error("Choose an output folder before recording");
      demoState = "recording";
      demoStarted = performance.now();
      demoElapsedBefore = 0;
      demoBytes = 0;
      demoClips = 0;
      return demoStats() as T;
    case "pause_recording":
      if (demoState === "recording") {
        demoElapsedBefore += performance.now() - demoStarted;
        demoState = "paused";
      } else if (demoState === "paused") {
        demoStarted = performance.now();
        demoState = "recording";
      } else {
        throw new Error("Not recording");
      }
      return demoStats() as T;
    case "stop_recording":
      if (demoState === "idle") throw new Error("Not recording");
      if (demoState === "recording") {
        demoElapsedBefore += performance.now() - demoStarted;
      }
      demoState = "idle";
      return demoStats() as T;
    case "poll_live":
      return demoLive() as T;
    default:
      throw new Error(`Unknown command ${cmd}`);
  }
}

function demoStats(): SessionStats {
  let elapsed = demoElapsedBefore;
  if (demoState === "recording") elapsed += performance.now() - demoStarted;
  return {
    state: demoState,
    elapsed_ms: Math.floor(elapsed),
    bytes_written: demoBytes,
    file_path:
      demoState === "idle" && demoBytes === 0
        ? null
        : `${demoSettings.output_dir}/buka-quality-sound-demo.wav`,
    segment_index: 0,
    sample_rate: demoSettings.sample_rate === "hz44100" ? 44100 : 48000,
    format: demoSettings.format,
    clipping: demoClips > 0,
    clip_count: demoClips,
    error: null,
  };
}

function demoLive(): LiveSnapshot {
  const waveform = Array.from({ length: 128 }, (_, i) => {
    if (demoState !== "recording") return 0.04 + Math.random() * 0.02;
    const t = demoPhase + i * 0.08;
    return Math.min(1, Math.abs(Math.sin(t) * 0.55 + Math.sin(t * 0.37) * 0.25) + Math.random() * 0.08);
  });
  if (demoState === "recording") {
    demoPhase += 0.2;
    demoBytes += 48000 * 2 * 3 * 0.05;
    const peak = Math.max(...waveform);
    if (peak > 0.98) demoClips += 1;
  }
  const peak = demoState === "recording" ? 0.35 + Math.random() * 0.45 : 0.02;
  return {
    meter: {
      peak_l: peak,
      peak_r: peak * (0.9 + Math.random() * 0.1),
      rms_l: peak * 0.55,
      rms_r: peak * 0.5,
      waveform,
      clipping: demoClips > 0,
      clip_count: demoClips,
    },
    stats: demoStats(),
  };
}

export const api = {
  getCapabilities: () => invoke<CaptureCapabilities>("get_capabilities"),
  listDevices: () => invoke<AudioDeviceInfo[]>("list_devices"),
  listAppSources: () => invoke<AppAudioSource[]>("list_app_sources"),
  getSettings: () => invoke<RecordSettings>("get_settings"),
  updateSettings: (settings: RecordSettings) =>
    invoke<void>("update_settings", { settings }),
  defaultOutputDir: () => invoke<string>("default_output_dir"),
  start: () => invoke<SessionStats>("start_recording"),
  pause: () => invoke<SessionStats>("pause_recording"),
  stop: () => invoke<SessionStats>("stop_recording"),
  pollLive: () => invoke<LiveSnapshot>("poll_live"),
  async pickFolder(): Promise<string | null> {
    if (!isTauri()) {
      return demoSettings.output_dir;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  },
};
