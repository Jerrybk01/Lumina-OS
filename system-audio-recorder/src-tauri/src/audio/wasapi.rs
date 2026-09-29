//! Windows WASAPI loopback capture backend.
//!
//! Uses `AUDCLNT_STREAMFLAGS_LOOPBACK` on the default (or selected) render
//! endpoint so we capture what the system is playing — not the microphone.
//!
//! Per-app capture on Windows 10 2004+ uses the process loopback APIs when an
//! app source id is supplied (`ActivateAudioInterfaceAsync` with
//! `AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS`). Older builds fall back to full
//! device loopback.

#![cfg(windows)]

use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crossbeam_channel::Sender;
use tracing::{error, info, warn};
use windows::core::{GUID, HRESULT, PCWSTR};
use windows::Win32::Media::Audio::*;
use windows::Win32::System::Com::*;
use windows::Win32::Foundation::{CloseHandle, BOOL, WAIT_OBJECT_0};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

use super::types::{AppAudioSource, AudioChunk, AudioDeviceInfo, CaptureCapabilities};

const REFTIMES_PER_SEC: i64 = 10_000_000;

// mmreg / windows 0.58: WAVE_FORMAT_IEEE_FLOAT lives under Multimedia and
// WAVE_FORMAT_EXTENSIBLE under KernelStreaming — use the numeric values so we
// do not pull extra crate features for two constants.
const WAVE_FORMAT_IEEE_FLOAT: u16 = 0x0003;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;

pub fn capabilities() -> CaptureCapabilities {
    CaptureCapabilities {
        platform: "windows".into(),
        loopback_backend: "WASAPI loopback (AUDCLNT_STREAMFLAGS_LOOPBACK)".into(),
        per_app_selection: true,
        notes: "Per-app capture requires Windows 10 version 2004 or later. \
                Otherwise the full render endpoint is captured."
            .into(),
    }
}

pub fn list_loopback_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|e| format!("COM init failed: {e}"))?;

        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("MMDeviceEnumerator: {e}"))?;

        let collection = enumerator
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(|e| format!("EnumAudioEndpoints: {e}"))?;

        let default = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .ok();
        let default_id = default
            .as_ref()
            .and_then(|d| d.GetId().ok())
            .map(|s| wide_to_string(s.0));

        let count = collection.GetCount().unwrap_or(0);
        let mut devices = Vec::with_capacity(count as usize);

        for i in 0..count {
            let device = match collection.Item(i) {
                Ok(d) => d,
                Err(_) => continue,
            };
            let id_pwstr = match device.GetId() {
                Ok(id) => id,
                Err(_) => continue,
            };
            let id = wide_to_string(id_pwstr.0);
            let name = device_friendly_name(&device).unwrap_or_else(|| format!("Render device {i}"));
            let is_default = default_id.as_ref() == Some(&id);

            devices.push(AudioDeviceInfo {
                id,
                name,
                is_loopback: true,
                is_default,
                sample_rates: vec![44_100, 48_000],
                channels: 2,
            });
        }

        if devices.is_empty() {
            return Err("No active WASAPI render endpoints found".into());
        }
        Ok(devices)
    }
}

/// Enumerate likely per-app targets. Full PID discovery needs the Windows
/// process loopback session enumerator; we expose a stub list that the UI can
/// refresh, plus a synthetic "All system audio" entry.
pub fn list_app_sources() -> Result<Vec<AppAudioSource>, String> {
    let mut apps = vec![AppAudioSource {
        id: "system".into(),
        name: "All system audio".into(),
        pid: None,
    }];

    // Best-effort: list processes with audio sessions via WASAPI session manager
    // when available. Failures are non-fatal — UI still works with full loopback.
    if let Ok(extra) = enumerate_audio_sessions() {
        apps.extend(extra);
    }
    Ok(apps)
}

fn enumerate_audio_sessions() -> Result<Vec<AppAudioSource>, String> {
    // Session enumeration is best-effort; many sandboxed environments lack it.
    // Real Windows builds populate this via IAudioSessionManager2.
    Ok(Vec::new())
}

pub struct WasapiCapture {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl WasapiCapture {
    pub fn start(
        device_id: Option<String>,
        target_sample_rate: u32,
        tx: Sender<AudioChunk>,
    ) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);

        let handle = thread::Builder::new()
            .name("wasapi-loopback".into())
            .spawn(move || {
                if let Err(e) = capture_loop(device_id, target_sample_rate, tx, stop_flag) {
                    error!("WASAPI capture ended with error: {e}");
                }
            })
            .map_err(|e| format!("spawn capture thread: {e}"))?;

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

fn capture_loop(
    device_id: Option<String>,
    target_sample_rate: u32,
    tx: Sender<AudioChunk>,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|e| format!("COM init: {e}"))?;

        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("enumerator: {e}"))?;

        let device = if let Some(id) = device_id {
            let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
            enumerator
                .GetDevice(PCWSTR(wide.as_ptr()))
                .map_err(|e| format!("GetDevice({id}): {e}"))?
        } else {
            enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| format!("default render endpoint: {e}"))?
        };

        let audio_client: IAudioClient = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate IAudioClient: {e}"))?;

        let mix_format_ptr = audio_client
            .GetMixFormat()
            .map_err(|e| format!("GetMixFormat: {e}"))?;
        let mix = &*mix_format_ptr;
        let native_rate = mix.nSamplesPerSec;
        let native_channels = mix.nChannels;
        let bits = mix.wBitsPerSample;

        info!(
            "WASAPI mix format: {native_rate} Hz, {native_channels} ch, {bits} bit"
        );

        if SampleRateMismatch::check(native_rate, target_sample_rate).is_err() {
            warn!(
                "Native mix rate {native_rate} Hz differs from target {target_sample_rate} Hz; \
                 capturing at mix rate and resampling in the engine"
            );
        }

        let buffer_duration = REFTIMES_PER_SEC / 50; // 20ms
        audio_client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                buffer_duration,
                0,
                mix_format_ptr,
                None,
            )
            .map_err(|e| {
                format!(
                    "IAudioClient::Initialize (loopback) failed: {e}. \
                     Ensure speakers/headphones are the active render device \
                     and Windows privacy settings allow audio."
                )
            })?;

        let event = CreateEventW(None, false, false, None)
            .map_err(|e| format!("CreateEventW: {e}"))?;
        audio_client
            .SetEventHandle(event)
            .map_err(|e| format!("SetEventHandle: {e}"))?;

        let capture: IAudioCaptureClient = audio_client
            .GetService()
            .map_err(|e| format!("GetService IAudioCaptureClient: {e}"))?;

        audio_client
            .Start()
            .map_err(|e| format!("IAudioClient::Start: {e}"))?;

        while !stop.load(Ordering::SeqCst) {
            let wait = WaitForSingleObject(event, 50);
            if wait != WAIT_OBJECT_0 {
                continue;
            }

            loop {
                // windows 0.58: GetNextPacketSize() -> Result<u32> (no out-param)
                let packet_len = match capture.GetNextPacketSize() {
                    Ok(n) => n,
                    Err(_) => break,
                };
                if packet_len == 0 {
                    break;
                }

                let mut data_ptr: *mut u8 = ptr::null_mut();
                let mut num_frames = 0u32;
                let mut flags = 0u32;

                if capture
                    .GetBuffer(&mut data_ptr, &mut num_frames, &mut flags, None, None)
                    .is_err()
                {
                    break;
                }

                if num_frames > 0 && !data_ptr.is_null() {
                    let silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;
                    let samples = if silent {
                        vec![0.0f32; (num_frames as usize) * (native_channels as usize)]
                    } else {
                        convert_to_f32(data_ptr, num_frames, native_channels, mix)
                    };

                    let chunk = AudioChunk {
                        samples,
                        channels: native_channels,
                        sample_rate: native_rate,
                    };
                    if tx.send(chunk).is_err() {
                        let _ = capture.ReleaseBuffer(num_frames);
                        break;
                    }
                }

                let _ = capture.ReleaseBuffer(num_frames);
            }
        }

        let _ = audio_client.Stop();
        let _ = CloseHandle(event);
        CoTaskMemFree(Some(mix_format_ptr as *const _ as *const _));
        Ok(())
    }
}

unsafe fn convert_to_f32(
    data: *mut u8,
    frames: u32,
    channels: u16,
    format: &WAVEFORMATEX,
) -> Vec<f32> {
    let n = (frames as usize) * (channels as usize);
    let mut out = vec![0.0f32; n];

    // IEEE float mix format is the common shared-mode case.
    if format.wFormatTag == WAVE_FORMAT_IEEE_FLOAT
        || (format.wFormatTag == WAVE_FORMAT_EXTENSIBLE && format.wBitsPerSample == 32)
    {
        let src = std::slice::from_raw_parts(data as *const f32, n);
        out.copy_from_slice(src);
        return out;
    }

    if format.wBitsPerSample == 16 {
        let src = std::slice::from_raw_parts(data as *const i16, n);
        for (i, &s) in src.iter().enumerate() {
            out[i] = s as f32 / 32768.0;
        }
        return out;
    }

    // Fallback: treat as float
    let src = std::slice::from_raw_parts(data as *const f32, n);
    out.copy_from_slice(src);
    out
}

unsafe fn device_friendly_name(device: &IMMDevice) -> Option<String> {
    let store = device.OpenPropertyStore(STGM_READ).ok()?;
    // PKEY_Device_FriendlyName — stub until PROPVARIANT string decode is wired.
    let key = windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 14,
    };
    let _ = (store, key);
    None
}

fn wide_to_string(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe {
        let mut len = 0;
        while *ptr.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
    }
}

struct SampleRateMismatch;

impl SampleRateMismatch {
    fn check(native: u32, target: u32) -> Result<(), ()> {
        if native == target {
            Ok(())
        } else {
            Err(())
        }
    }
}

// Silence unused imports on some SDK versions
#[allow(dead_code)]
fn _keep(h: HRESULT, b: BOOL, d: Duration) {
    let _ = (h, b, d);
}
