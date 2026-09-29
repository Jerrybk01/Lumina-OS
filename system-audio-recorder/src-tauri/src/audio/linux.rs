//! Linux system-audio capture via PulseAudio / PipeWire monitor sources.
//!
//! ## Limitations (important)
//!
//! - Linux has **no** first-class WASAPI/CoreAudio-style loopback API.
//! - We capture a **monitor** of a sink (e.g. `alsa_output...monitor`), which
//!   is the mixed output of that sink — closest equivalent to system audio.
//! - **Per-app selection** is unreliable: classic PulseAudio exposes sink inputs
//!   but isolating one app's PCM without affecting others requires PipeWire
//!   graph surgery. We list sink inputs when available and document the gap.
//! - Flatpak/Snap sandboxes often block monitor access; users may need
//!   `pipewire` / `pulseaudio` permissions.
//! - Sample-rate mismatches are resampled in the engine (same as other backends).

#![cfg(target_os = "linux")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use crossbeam_channel::Sender;
use tracing::warn;

use super::types::{AppAudioSource, AudioChunk, AudioDeviceInfo, CaptureCapabilities};

pub fn capabilities() -> CaptureCapabilities {
    CaptureCapabilities {
        platform: "linux".into(),
        loopback_backend: "PulseAudio/PipeWire sink monitor".into(),
        per_app_selection: false,
        notes: "Linux captures the monitor of the default (or selected) sink — \
                mixed system output, not a microphone. True per-app isolation is \
                limited; prefer PipeWire session management for advanced routing. \
                Install `libpulse` development headers to enable the optional \
                `linux-pulse` feature."
            .into(),
    }
}

#[cfg(feature = "linux-pulse")]
mod pulse_impl {
    use super::*;
    use libpulse_binding::sample::{Format, Spec};
    use libpulse_binding::stream::Direction;
    use libpulse_simple_binding::Simple;

    pub fn list_loopback_devices() -> Result<Vec<AudioDeviceInfo>, String> {
        // Without a full context introspect loop, expose a sensible default
        // monitor name that works on most Pulse/PipeWire desktops.
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

    fn resolve_monitor_name(device_id: Option<String>) -> String {
        match device_id.as_deref() {
            None | Some("@DEFAULT_MONITOR@") => {
                // Pulse accepts the special default source; many PipeWire setups
                // map this to the default sink's monitor.
                "@DEFAULT_MONITOR@".into()
            }
            Some(other) => other.to_string(),
        }
    }

    fn capture_loop(
        source: &str,
        sample_rate: u32,
        tx: Sender<AudioChunk>,
        stop: Arc<AtomicBool>,
    ) -> Result<(), String> {
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

        info!("Opening Pulse monitor source '{source}' at {sample_rate} Hz");

        let simple = Simple::new(
            None,
            "Lumina Capture",
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
        })?;

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
}

#[cfg(feature = "linux-pulse")]
pub use pulse_impl::{list_app_sources, list_loopback_devices, PulseCapture};

#[cfg(not(feature = "linux-pulse"))]
pub fn list_loopback_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    Ok(vec![AudioDeviceInfo {
        id: "demo".into(),
        name: "Demo sink monitor (linux-pulse feature disabled)".into(),
        is_loopback: true,
        is_default: true,
        sample_rates: vec![44_100, 48_000],
        channels: 2,
    }])
}

#[cfg(not(feature = "linux-pulse"))]
pub fn list_app_sources() -> Result<Vec<AppAudioSource>, String> {
    Ok(vec![AppAudioSource {
        id: "system".into(),
        name: "All system audio".into(),
        pid: None,
    }])
}

#[cfg(not(feature = "linux-pulse"))]
pub struct PulseCapture {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

#[cfg(not(feature = "linux-pulse"))]
impl PulseCapture {
    pub fn start(
        _device_id: Option<String>,
        target_sample_rate: u32,
        tx: Sender<AudioChunk>,
    ) -> Result<Self, String> {
        warn!("linux-pulse feature disabled — running silent demo capture thread");
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);
        let handle = thread::Builder::new()
            .name("demo-capture".into())
            .spawn(move || {
                let channels = 2u16;
                let frames = (target_sample_rate / 50) as usize;
                let mut phase = 0.0f32;
                while !stop_flag.load(Ordering::SeqCst) {
                    // Soft demo tone so UI meters move during Linux CI without Pulse.
                    let mut samples = vec![0.0f32; frames * channels as usize];
                    for i in 0..frames {
                        let s = (phase * 2.0 * std::f32::consts::PI).sin() * 0.15;
                        samples[i * 2] = s;
                        samples[i * 2 + 1] = s;
                        phase += 440.0 / target_sample_rate as f32;
                        if phase > 1.0 {
                            phase -= 1.0;
                        }
                    }
                    if tx
                        .send(AudioChunk {
                            samples,
                            channels,
                            sample_rate: target_sample_rate,
                        })
                        .is_err()
                    {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(20));
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
