//! Linux system-audio capture via PulseAudio / PipeWire monitor sources.
//!
//! ## Behavior
//!
//! - Opens a **sink monitor** (e.g. `@DEFAULT_MONITOR@` / `…monitor`) — the mixed
//!   output of that sink, not a microphone.
//! - **Per-app selection is not advertised** — clean per-app isolation needs
//!   PipeWire graph routing outside this app.
//! - Requires `libpulse` at build and runtime (always linked on Linux).

#![cfg(target_os = "linux")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use crossbeam_channel::Sender;
use libpulse_binding::sample::{Format, Spec};
use libpulse_binding::stream::Direction;
use libpulse_simple_binding::Simple;
use tracing::{error, info};

use super::types::{AppAudioSource, AudioChunk, AudioDeviceInfo, CaptureCapabilities};

pub fn capabilities() -> CaptureCapabilities {
    CaptureCapabilities {
        platform: "linux".into(),
        loopback_backend: "PulseAudio/PipeWire sink monitor".into(),
        per_app_selection: false,
        notes: "Records the monitor of the default (or selected) sink — mixed \
                system output, not a microphone. Per-app isolation is not supported \
                in this app; use PipeWire routing for advanced splits. Requires a \
                running PulseAudio or PipeWire Pulse server and `libpulse`."
            .into(),
    }
}

pub fn list_loopback_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    // Prefer a small, reliable set of monitor targets. PipeWire/Pulse map
    // `@DEFAULT_MONITOR@` to the default sink's monitor on modern desktops.
    Ok(vec![
        AudioDeviceInfo {
            id: "@DEFAULT_MONITOR@".into(),
            name: "Default sink monitor (system audio)".into(),
            is_loopback: true,
            is_default: true,
            sample_rates: vec![44_100, 48_000],
            channels: 2,
        },
        AudioDeviceInfo {
            id: "auto_null.monitor".into(),
            name: "Null sink monitor (if configured)".into(),
            is_loopback: true,
            is_default: false,
            sample_rates: vec![44_100, 48_000],
            channels: 2,
        },
    ])
}

pub fn list_app_sources() -> Result<Vec<AppAudioSource>, String> {
    Ok(vec![AppAudioSource {
        id: "system".into(),
        name: "All system audio (sink monitor)".into(),
        pid: None,
    }])
}

pub struct PulseCapture {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl PulseCapture {
    pub fn start(
        device_id: Option<String>,
        target_sample_rate: u32,
        tx: Sender<AudioChunk>,
    ) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);
        let source = resolve_monitor_name(device_id);

        // Fail fast so the UI does not show a fake "recording" session.
        probe_monitor(&source, target_sample_rate)?;

        let handle = thread::Builder::new()
            .name("pulse-monitor".into())
            .spawn(move || {
                if let Err(e) = capture_loop(&source, target_sample_rate, tx, stop_flag) {
                    error!("Pulse monitor capture ended: {e}");
                }
            })
            .map_err(|e| format!("spawn: {e}"))?;

        Ok(Self {
            stop,
            handle: Some(handle),
        })
    }

    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

pub(crate) fn resolve_monitor_name(device_id: Option<String>) -> String {
    match device_id.as_deref() {
        None | Some("") | Some("@DEFAULT_MONITOR@") | Some("demo") => {
            "@DEFAULT_MONITOR@".into()
        }
        Some(other) => other.to_string(),
    }
}

fn open_simple(source: &str, sample_rate: u32) -> Result<Simple, String> {
    let spec = Spec {
        format: Format::F32le,
        channels: 2,
        rate: sample_rate,
    };
    if !spec.is_valid() {
        return Err(format!(
            "Invalid Pulse sample spec ({sample_rate} Hz / 2ch F32). \
             Choose 44100 or 48000 Hz."
        ));
    }

    Simple::new(
        None,
        "Buka Quality Sound",
        Direction::Record,
        Some(source),
        "System audio loopback",
        &spec,
        None,
        None,
    )
    .map_err(|e| {
        format!(
            "Failed to open PulseAudio monitor '{source}': {e}. \
             Check that PipeWire/Pulse is running and the sink has a .monitor source. \
             Mic devices are intentionally not used."
        )
    })
}

fn probe_monitor(source: &str, sample_rate: u32) -> Result<(), String> {
    let simple = open_simple(source, sample_rate)?;
    // Read one small buffer to prove the monitor produces PCM.
    let mut buf = vec![0u8; 4 * 2 * 64];
    simple
        .read(&mut buf)
        .map_err(|e| format!("Pulse monitor probe read failed on '{source}': {e}"))?;
    drop(simple);
    Ok(())
}

fn capture_loop(
    source: &str,
    sample_rate: u32,
    tx: Sender<AudioChunk>,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    info!("Opening Pulse monitor source '{source}' at {sample_rate} Hz");
    let simple = open_simple(source, sample_rate)?;

    let channels = 2u16;
    let frames = (sample_rate / 50) as usize; // 20 ms
    let bytes = frames * (channels as usize) * 4;
    let mut buf = vec![0u8; bytes];

    while !stop.load(Ordering::SeqCst) {
        if let Err(e) = simple.read(&mut buf) {
            return Err(format!("Pulse read error: {e}"));
        }
        let mut samples = vec![0.0f32; frames * channels as usize];
        for (i, chunk) in buf.chunks_exact(4).enumerate() {
            samples[i] = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        if tx
            .send(AudioChunk {
                samples,
                channels,
                sample_rate,
            })
            .is_err()
        {
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_do_not_advertise_per_app() {
        let caps = capabilities();
        assert_eq!(caps.platform, "linux");
        assert!(!caps.per_app_selection);
        assert!(caps.loopback_backend.to_lowercase().contains("pulse")
            || caps.loopback_backend.to_lowercase().contains("pipewire"));
        assert!(!caps.notes.to_lowercase().contains("demo tone"));
    }

    #[test]
    fn resolve_monitor_defaults() {
        assert_eq!(resolve_monitor_name(None), "@DEFAULT_MONITOR@");
        assert_eq!(
            resolve_monitor_name(Some("demo".into())),
            "@DEFAULT_MONITOR@"
        );
        assert_eq!(
            resolve_monitor_name(Some("alsa_output.pci.monitor".into())),
            "alsa_output.pci.monitor"
        );
    }

    #[test]
    fn list_devices_marks_loopback() {
        let devices = list_loopback_devices().unwrap();
        assert!(!devices.is_empty());
        assert!(devices.iter().all(|d| d.is_loopback));
        assert!(devices.iter().any(|d| d.is_default));
    }
}
