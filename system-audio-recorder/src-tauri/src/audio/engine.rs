//! Multi-threaded audio engine: owns capture backend, metering, DSP, and writer fan-out.
//!
//! Thread model
//! ------------
//! - **Capture thread** (platform backend): produces `AudioChunk` on a bounded channel.
//! - **Process thread** (this module): resamples, noise-reduces, meters, silence-splits,
//!   and forwards PCM to the FileWriter.
//! - **UI thread**: polls `meter()` / `stats()` via Tauri commands (lock-free-ish via
//!   `parking_lot::Mutex` snapshots).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crossbeam_channel::{bounded, Receiver, Sender};
use parking_lot::Mutex;
use tracing::{info, warn};

use super::meter::PeakMeter;
use super::noise_reduce::NoiseReducer;
use super::silence_split::SilenceSplitter;
use super::types::{
    AppAudioSource, AudioChunk, AudioDeviceInfo, CaptureCapabilities, ExportFormat, MeterSnapshot,
    RecordSettings, RecorderState, SampleRate, SessionStats,
};

use crate::writer::{FileWriter, WriterConfig};

enum PlatformCapture {
    #[cfg(windows)]
    Wasapi(super::wasapi::WasapiCapture),
    #[cfg(target_os = "macos")]
    CoreAudio(super::coreaudio::CoreAudioCapture),
    #[cfg(target_os = "linux")]
    Pulse(super::linux::PulseCapture),
}

pub struct AudioEngine {
    inner: Mutex<EngineInner>,
}

struct EngineInner {
    state: RecorderState,
    settings: RecordSettings,
    meter: PeakMeter,
    stats: SessionStats,
    capture: Option<PlatformCapture>,
    process_stop: Option<Arc<AtomicBool>>,
    process_handle: Option<JoinHandle<()>>,
    pause_flag: Arc<AtomicBool>,
    started_at: Option<Instant>,
    elapsed_before_pause: Duration,
    clip_latched: bool,
}

impl AudioEngine {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(EngineInner {
                state: RecorderState::Idle,
                settings: RecordSettings::default(),
                meter: PeakMeter::new(128, 48_000),
                stats: SessionStats::default(),
                capture: None,
                process_stop: None,
                process_handle: None,
                pause_flag: Arc::new(AtomicBool::new(false)),
                started_at: None,
                elapsed_before_pause: Duration::ZERO,
                clip_latched: false,
            }),
        }
    }

    pub fn capabilities(&self) -> CaptureCapabilities {
        platform_capabilities()
    }

    pub fn list_devices(&self) -> Result<Vec<AudioDeviceInfo>, String> {
        platform_list_devices()
    }

    pub fn list_app_sources(&self) -> Result<Vec<AppAudioSource>, String> {
        platform_list_apps()
    }

    pub fn meter_snapshot(&self) -> MeterSnapshot {
        let mut g = self.inner.lock();
        g.meter.snapshot_and_decay()
    }

    pub fn session_stats(&self) -> SessionStats {
        let mut g = self.inner.lock();
        g.refresh_elapsed();
        g.stats.clone()
    }

    pub fn update_settings(&self, settings: RecordSettings) -> Result<(), String> {
        let mut g = self.inner.lock();
        if g.state != RecorderState::Idle {
            return Err("Cannot change settings while recording".into());
        }
        validate_settings(&settings)?;
        g.settings = settings;
        Ok(())
    }

    pub fn current_settings(&self) -> RecordSettings {
        self.inner.lock().settings.clone()
    }

    pub fn start(&self) -> Result<SessionStats, String> {
        let mut g = self.inner.lock();
        if g.state != RecorderState::Idle {
            return Err("Already recording or paused".into());
        }
        validate_settings(&g.settings)?;

        let sample_rate = g.settings.sample_rate.hz();
        g.meter = PeakMeter::new(128, sample_rate);
        g.clip_latched = false;
        g.pause_flag.store(false, Ordering::SeqCst);
        g.elapsed_before_pause = Duration::ZERO;

        let (tx, rx) = bounded::<AudioChunk>(64);
        let capture = start_platform_capture(
            g.settings.device_id.clone(),
            g.settings.app_source_id.clone(),
            sample_rate,
            tx,
        )?;

        let stop = Arc::new(AtomicBool::new(false));
        let pause = Arc::clone(&g.pause_flag);
        let shared_meter = Arc::new(Mutex::new(PeakMeter::new(128, sample_rate)));
        let shared_stats = Arc::new(Mutex::new(SessionStats {
            state: RecorderState::Recording,
            sample_rate,
            format: g.settings.format,
            segment_index: 0,
            ..SessionStats::default()
        }));

        // Mirror meter/stats into engine on poll via process thread updates.
        let writer_cfg = WriterConfig {
            output_dir: PathBuf::from(&g.settings.output_dir),
            format: g.settings.format,
            sample_rate,
            channels: 2,
            mp3_bitrate_kbps: g.settings.mp3_bitrate_kbps,
        };

        let settings = g.settings.clone();
        let stop_flag = Arc::clone(&stop);
        let meter_for_thread = Arc::clone(&shared_meter);
        let stats_for_thread = Arc::clone(&shared_stats);

        let handle = thread::Builder::new()
            .name("audio-process".into())
            .spawn(move || {
                process_loop(
                    rx,
                    stop_flag,
                    pause,
                    settings,
                    writer_cfg,
                    meter_for_thread,
                    stats_for_thread,
                );
            })
            .map_err(|e| format!("Failed to start process thread: {e}"))?;

        // Store shared mirrors on engine for UI polling.
        g.capture = Some(capture);
        g.process_stop = Some(stop);
        g.process_handle = Some(handle);
        g.state = RecorderState::Recording;
        g.started_at = Some(Instant::now());
        g.stats = SessionStats {
            state: RecorderState::Recording,
            sample_rate,
            format: g.settings.format,
            segment_index: 0,
            file_path: None,
            ..SessionStats::default()
        };

        // Keep Arc mirrors reachable: stash in thread-local bridge via once_cell.
        METER_BRIDGE.lock().replace(shared_meter);
        STATS_BRIDGE.lock().replace(shared_stats);

        info!("Recording started at {sample_rate} Hz");
        Ok(g.stats.clone())
    }

    pub fn pause(&self) -> Result<SessionStats, String> {
        let mut g = self.inner.lock();
        match g.state {
            RecorderState::Recording => {
                g.pause_flag.store(true, Ordering::SeqCst);
                if let Some(t0) = g.started_at.take() {
                    g.elapsed_before_pause += t0.elapsed();
                }
                g.state = RecorderState::Paused;
                g.stats.state = RecorderState::Paused;
                Ok(g.stats.clone())
            }
            RecorderState::Paused => {
                g.pause_flag.store(false, Ordering::SeqCst);
                g.started_at = Some(Instant::now());
                g.state = RecorderState::Recording;
                g.stats.state = RecorderState::Recording;
                Ok(g.stats.clone())
            }
            RecorderState::Idle => Err("Not recording".into()),
        }
    }

    pub fn stop(&self) -> Result<SessionStats, String> {
        let mut g = self.inner.lock();
        if g.state == RecorderState::Idle {
            return Err("Not recording".into());
        }

        if let Some(stop) = g.process_stop.take() {
            stop.store(true, Ordering::SeqCst);
        }
        if let Some(cap) = g.capture.take() {
            stop_platform_capture(cap);
        }
        if let Some(h) = g.process_handle.take() {
            let _ = h.join();
        }

        g.refresh_elapsed();
        g.state = RecorderState::Idle;
        g.stats.state = RecorderState::Idle;
        g.started_at = None;
        g.pause_flag.store(false, Ordering::SeqCst);

        if let Some(stats) = STATS_BRIDGE.lock().as_ref() {
            let s = stats.lock().clone();
            g.stats.bytes_written = s.bytes_written;
            g.stats.file_path = s.file_path.clone();
            g.stats.segment_index = s.segment_index;
            g.stats.clip_count = s.clip_count;
            g.stats.clipping = s.clipping;
            g.stats.error = s.error.clone();
        }

        METER_BRIDGE.lock().take();
        STATS_BRIDGE.lock().take();

        info!("Recording stopped");
        Ok(g.stats.clone())
    }

    pub fn poll_live(&self) -> (MeterSnapshot, SessionStats) {
        let mut g = self.inner.lock();
        g.refresh_elapsed();

        let meter = if let Some(m) = METER_BRIDGE.lock().as_ref() {
            m.lock().snapshot_and_decay()
        } else {
            g.meter.snapshot_and_decay()
        };

        if let Some(stats) = STATS_BRIDGE.lock().as_ref() {
            let s = stats.lock();
            g.stats.bytes_written = s.bytes_written;
            g.stats.file_path = s.file_path.clone();
            g.stats.segment_index = s.segment_index;
            g.stats.clip_count = s.clip_count;
            g.stats.clipping = s.clipping;
            if s.clipping {
                g.clip_latched = true;
            }
            g.stats.error = s.error.clone();
        }
        if g.clip_latched {
            g.stats.clipping = true;
        }

        (meter, g.stats.clone())
    }
}

impl EngineInner {
    fn refresh_elapsed(&mut self) {
        let mut elapsed = self.elapsed_before_pause;
        if self.state == RecorderState::Recording {
            if let Some(t0) = self.started_at {
                elapsed += t0.elapsed();
            }
        }
        self.stats.elapsed_ms = elapsed.as_millis() as u64;
        self.stats.state = self.state;
    }
}

use once_cell::sync::Lazy;
static METER_BRIDGE: Lazy<Mutex<Option<Arc<Mutex<PeakMeter>>>>> =
    Lazy::new(|| Mutex::new(None));
static STATS_BRIDGE: Lazy<Mutex<Option<Arc<Mutex<SessionStats>>>>> =
    Lazy::new(|| Mutex::new(None));

fn validate_settings(s: &RecordSettings) -> Result<(), String> {
    if s.output_dir.trim().is_empty() {
        return Err("Choose an output folder before recording".into());
    }
    let path = PathBuf::from(&s.output_dir);
    if !path.exists() {
        return Err(format!(
            "Output folder does not exist: {}. Create it or pick another folder.",
            s.output_dir
        ));
    }
    if !path.is_dir() {
        return Err("Output path must be a folder".into());
    }
    match s.sample_rate {
        SampleRate::Hz44100 | SampleRate::Hz48000 => {}
    }
    if matches!(s.format, ExportFormat::Mp3) && !(64..=320).contains(&s.mp3_bitrate_kbps) {
        return Err("MP3 bitrate must be between 64 and 320 kbps".into());
    }
    Ok(())
}

fn process_loop(
    rx: Receiver<AudioChunk>,
    stop: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
    settings: RecordSettings,
    writer_cfg: WriterConfig,
    meter: Arc<Mutex<PeakMeter>>,
    stats: Arc<Mutex<SessionStats>>,
) {
    let mut writer = match FileWriter::create(writer_cfg.clone(), 0) {
        Ok(w) => w,
        Err(e) => {
            stats.lock().error = Some(e);
            return;
        }
    };
    {
        let mut s = stats.lock();
        s.file_path = Some(writer.path().display().to_string());
    }

    let mut noise = NoiseReducer::new(settings.noise_reduction);
    let mut splitter = SilenceSplitter::new(
        settings.auto_split,
        settings.silence_threshold_db,
        settings.silence_duration_ms,
        settings.sample_rate.hz(),
    );
    let mut segment = 0u32;
    let target_rate = settings.sample_rate.hz();
    let target_ch = 2u16;

    while !stop.load(Ordering::SeqCst) {
        let chunk = match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(c) => c,
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
        };

        if pause.load(Ordering::SeqCst) {
            continue;
        }

        let mut samples = match resample_if_needed(&chunk, target_rate, target_ch) {
            Ok(s) => s,
            Err(e) => {
                warn!("{e}");
                stats.lock().error = Some(e);
                continue;
            }
        };

        noise.process_inplace(&mut samples, target_ch);
        meter.lock().process_interleaved(&samples, target_ch);

        let clip_count = meter.lock().clip_count();
        {
            let mut s = stats.lock();
            s.clip_count = clip_count;
            s.clipping = clip_count > 0;
        }

        if splitter.process(&samples, target_ch) {
            if let Err(e) = writer.finalize() {
                stats.lock().error = Some(e);
                break;
            }
            segment += 1;
            match FileWriter::create(writer_cfg.clone(), segment) {
                Ok(w) => {
                    {
                        let mut s = stats.lock();
                        s.segment_index = segment;
                        s.file_path = Some(w.path().display().to_string());
                    }
                    writer = w;
                }
                Err(e) => {
                    stats.lock().error = Some(e);
                    break;
                }
            }
        }

        match writer.write_samples(&samples) {
            Ok(bytes) => {
                stats.lock().bytes_written += bytes;
            }
            Err(e) => {
                stats.lock().error = Some(e);
                break;
            }
        }
    }

    if let Err(e) = writer.finalize() {
        stats.lock().error = Some(e);
    }
}

fn resample_if_needed(
    chunk: &AudioChunk,
    target_rate: u32,
    target_ch: u16,
) -> Result<Vec<f32>, String> {
    let mut samples = chunk.samples.clone();

    // Channel normalize to stereo.
    if chunk.channels == 1 && target_ch == 2 {
        let mut stereo = Vec::with_capacity(samples.len() * 2);
        for s in samples {
            stereo.push(s);
            stereo.push(s);
        }
        samples = stereo;
    } else if chunk.channels != target_ch && chunk.channels != 0 {
        // Downmix / truncate extras to stereo.
        let ch = chunk.channels as usize;
        let frames = samples.len() / ch;
        let mut stereo = Vec::with_capacity(frames * 2);
        for i in 0..frames {
            let l = samples[i * ch];
            let r = if ch > 1 { samples[i * ch + 1] } else { l };
            stereo.push(l);
            stereo.push(r);
        }
        samples = stereo;
    }

    if chunk.sample_rate == target_rate {
        return Ok(samples);
    }

    // Lightweight linear resampler (keeps CPU low; rubato available for HQ offline).
    let ratio = target_rate as f64 / chunk.sample_rate as f64;
    let in_frames = samples.len() / 2;
    let out_frames = ((in_frames as f64) * ratio).round() as usize;
    let mut out = vec![0.0f32; out_frames * 2];
    for i in 0..out_frames {
        let src = i as f64 / ratio;
        let i0 = src.floor() as usize;
        let i1 = (i0 + 1).min(in_frames.saturating_sub(1));
        let t = (src - i0 as f64) as f32;
        for c in 0..2 {
            let a = samples[i0 * 2 + c];
            let b = samples[i1 * 2 + c];
            out[i * 2 + c] = a + (b - a) * t;
        }
    }
    Ok(out)
}

fn platform_capabilities() -> CaptureCapabilities {
    #[cfg(windows)]
    {
        return super::wasapi::capabilities();
    }
    #[cfg(target_os = "macos")]
    {
        return super::coreaudio::capabilities();
    }
    #[cfg(target_os = "linux")]
    {
        return super::linux::capabilities();
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        CaptureCapabilities {
            platform: "unknown".into(),
            loopback_backend: "none".into(),
            per_app_selection: false,
            notes: "Unsupported platform".into(),
        }
    }
}

fn platform_list_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    #[cfg(windows)]
    {
        return super::wasapi::list_loopback_devices();
    }
    #[cfg(target_os = "macos")]
    {
        return super::coreaudio::list_loopback_devices();
    }
    #[cfg(target_os = "linux")]
    {
        return super::linux::list_loopback_devices();
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported platform".into())
    }
}

fn platform_list_apps() -> Result<Vec<AppAudioSource>, String> {
    #[cfg(windows)]
    {
        return super::wasapi::list_app_sources();
    }
    #[cfg(target_os = "macos")]
    {
        return super::coreaudio::list_app_sources();
    }
    #[cfg(target_os = "linux")]
    {
        return super::linux::list_app_sources();
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        Err("Unsupported platform".into())
    }
}

fn start_platform_capture(
    device_id: Option<String>,
    app_source_id: Option<String>,
    sample_rate: u32,
    tx: Sender<AudioChunk>,
) -> Result<PlatformCapture, String> {
    #[cfg(windows)]
    {
        let _ = app_source_id;
        return Ok(PlatformCapture::Wasapi(super::wasapi::WasapiCapture::start(
            device_id,
            sample_rate,
            tx,
        )?));
    }
    #[cfg(target_os = "macos")]
    {
        return Ok(PlatformCapture::CoreAudio(
            super::coreaudio::CoreAudioCapture::start(device_id, app_source_id, sample_rate, tx)?,
        ));
    }
    #[cfg(target_os = "linux")]
    {
        let _ = app_source_id;
        return Ok(PlatformCapture::Pulse(super::linux::PulseCapture::start(
            device_id,
            sample_rate,
            tx,
        )?));
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = (device_id, app_source_id, sample_rate, tx);
        Err("Unsupported platform".into())
    }
}

fn stop_platform_capture(cap: PlatformCapture) {
    match cap {
        #[cfg(windows)]
        PlatformCapture::Wasapi(c) => c.stop(),
        #[cfg(target_os = "macos")]
        PlatformCapture::CoreAudio(c) => c.stop(),
        #[cfg(target_os = "linux")]
        PlatformCapture::Pulse(c) => c.stop(),
    }
}
