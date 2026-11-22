//! Windows WASAPI loopback capture backend.
//!
//! - **Full-device loopback**: `AUDCLNT_STREAMFLAGS_LOOPBACK` on a render endpoint.
//! - **Per-app loopback** (Windows 10 2004+): `ActivateAudioInterfaceAsync` with
//!   `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK` when a `pid:…` app source is selected.
//! - Device friendly names come from `PKEY_Device_FriendlyName`.
//! - App sources come from `IAudioSessionManager2` session enumeration.

#![cfg(windows)]

use std::mem::size_of;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crossbeam_channel::Sender;
use tracing::{error, info, warn};
use windows::core::{implement, Interface, GUID, HRESULT, PCWSTR, PROPVARIANT};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{CloseHandle, BOOL, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::*;
use windows::Win32::System::Com::*;
use windows::Win32::System::Threading::{
    CreateEventW, OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::System::Variant::VT_BLOB;

use super::app_source::{format_app_source_id, parse_app_source_pid};
use super::types::{AppAudioSource, AudioChunk, AudioDeviceInfo, CaptureCapabilities};

const REFTIMES_PER_SEC: i64 = 10_000_000;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 0x0003;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;

pub fn capabilities() -> CaptureCapabilities {
    CaptureCapabilities {
        platform: "windows".into(),
        loopback_backend: "WASAPI loopback (device + process)".into(),
        per_app_selection: true,
        notes: "Full-device loopback captures the render mix. Per-app capture uses \
                WASAPI process loopback (Windows 10 version 2004+). Older Windows \
                builds fall back to full-device loopback if process activation fails."
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

        let default = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok();
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
            let name =
                device_friendly_name(&device).unwrap_or_else(|| format!("Render device {i}"));
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

pub fn list_app_sources() -> Result<Vec<AppAudioSource>, String> {
    let mut apps = vec![AppAudioSource {
        id: "system".into(),
        name: "All system audio".into(),
        pid: None,
    }];

    match enumerate_audio_sessions() {
        Ok(extra) => apps.extend(extra),
        Err(e) => warn!("Audio session enumeration failed: {e}"),
    }
    Ok(apps)
}

fn enumerate_audio_sessions() -> Result<Vec<AppAudioSource>, String> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok().ok();

        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("MMDeviceEnumerator: {e}"))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("default render endpoint: {e}"))?;

        let manager: IAudioSessionManager2 = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate IAudioSessionManager2: {e}"))?;
        let sessions = manager
            .GetSessionEnumerator()
            .map_err(|e| format!("GetSessionEnumerator: {e}"))?;
        let count = sessions.GetCount().unwrap_or(0);

        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for i in 0..count {
            let control = match sessions.GetSession(i) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let control2: IAudioSessionControl2 = match control.cast() {
                Ok(c) => c,
                Err(_) => continue,
            };
            let pid = match control2.GetProcessId() {
                Ok(p) if p != 0 => p,
                _ => continue,
            };
            if !seen.insert(pid) {
                continue;
            }

            let display = control
                .GetDisplayName()
                .ok()
                .map(|p| wide_to_string(p.0))
                .filter(|s| !s.is_empty() && !s.starts_with('@'));
            let name = display
                .or_else(|| process_image_name(pid))
                .unwrap_or_else(|| format!("Process {pid}"));

            out.push(AppAudioSource {
                id: format_app_source_id(pid),
                name,
                pid: Some(pid),
            });
        }

        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(out)
    }
}

pub struct WasapiCapture {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl WasapiCapture {
    pub fn start(
        device_id: Option<String>,
        app_source_id: Option<String>,
        target_sample_rate: u32,
        tx: Sender<AudioChunk>,
    ) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);

        let handle = thread::Builder::new()
            .name("wasapi-loopback".into())
            .spawn(move || {
                if let Err(e) =
                    capture_loop(device_id, app_source_id, target_sample_rate, tx, stop_flag)
                {
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
    app_source_id: Option<String>,
    target_sample_rate: u32,
    tx: Sender<AudioChunk>,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|e| format!("COM init: {e}"))?;

        let pid = parse_app_source_pid(app_source_id.as_deref());
        let audio_client = if let Some(pid) = pid {
            match activate_process_loopback(pid) {
                Ok(client) => {
                    info!("WASAPI process loopback active for PID {pid}");
                    client
                }
                Err(e) => {
                    warn!(
                        "Process loopback for PID {pid} failed ({e}); falling back to full-device loopback"
                    );
                    activate_device_loopback(device_id)?
                }
            }
        } else {
            activate_device_loopback(device_id)?
        };

        run_capture_client(audio_client, target_sample_rate, tx, stop, pid.is_some())
    }
}

unsafe fn activate_device_loopback(device_id: Option<String>) -> Result<IAudioClient, String> {
    let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
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

    device
        .Activate(CLSCTX_ALL, None)
        .map_err(|e| format!("Activate IAudioClient: {e}"))
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct ActivationHandler {
    tx: Mutex<Option<mpsc::Sender<Result<IAudioClient, String>>>>,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationHandler_Impl {
    fn ActivateCompleted(
        &self,
        activateoperation: Option<&IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        let result = (|| {
            let op = activateoperation.ok_or_else(|| "missing activation operation".to_string())?;
            let mut activate_result = HRESULT(0);
            let mut unk = None;
            unsafe {
                op.GetActivateResult(&mut activate_result, &mut unk)
                    .map_err(|e| format!("GetActivateResult: {e}"))?;
            }
            if activate_result.is_err() {
                return Err(format!(
                    "process loopback activation HRESULT 0x{:08X}",
                    activate_result.0 as u32
                ));
            }
            let unk = unk.ok_or_else(|| "process loopback returned no interface".to_string())?;
            let client: IAudioClient = unk
                .cast()
                .map_err(|e| format!("cast IAudioClient: {e}"))?;
            Ok(client)
        })();

        if let Ok(mut guard) = self.tx.lock() {
            if let Some(tx) = guard.take() {
                let _ = tx.send(result);
            }
        }
        Ok(())
    }
}

unsafe fn activate_process_loopback(process_id: u32) -> Result<IAudioClient, String> {
    let activation_params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: process_id,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };

    // Build a VT_BLOB PROPVARIANT pointing at activation_params (must stay alive
    // for the ActivateAudioInterfaceAsync call).
    let mut blob = PropVariantBlob {
        vt: VT_BLOB.0 as u16,
        w_reserved1: 0,
        w_reserved2: 0,
        w_reserved3: 0,
        cb_size: size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
        p_blob_data: &activation_params as *const _ as *mut u8,
    };
    let prop = &mut blob as *mut PropVariantBlob as *mut PROPVARIANT;

    let (tx, rx) = mpsc::channel::<Result<IAudioClient, String>>();
    let handler: IActivateAudioInterfaceCompletionHandler = ActivationHandler {
        tx: Mutex::new(Some(tx)),
    }
    .into();

    let _operation = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        &IAudioClient::IID,
        Some(prop),
        &handler,
    )
    .map_err(|e| format!("ActivateAudioInterfaceAsync: {e}"))?;

    rx.recv_timeout(Duration::from_secs(10))
        .map_err(|_| "process loopback activation timed out".to_string())?
}

#[repr(C)]
struct PropVariantBlob {
    vt: u16,
    w_reserved1: u16,
    w_reserved2: u16,
    w_reserved3: u16,
    cb_size: u32,
    p_blob_data: *mut u8,
}

unsafe fn run_capture_client(
    audio_client: IAudioClient,
    target_sample_rate: u32,
    tx: Sender<AudioChunk>,
    stop: Arc<AtomicBool>,
    process_loopback: bool,
) -> Result<(), String> {
    // Keep owned_format alive for the whole function when using process loopback.
    let mut owned_format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_IEEE_FLOAT,
        nChannels: 2,
        nSamplesPerSec: target_sample_rate,
        nAvgBytesPerSec: target_sample_rate * 2 * 4,
        nBlockAlign: 8,
        wBitsPerSample: 32,
        cbSize: 0,
    };
    let mix_format_ptr: *mut WAVEFORMATEX = if process_loopback {
        &mut owned_format
    } else {
        audio_client
            .GetMixFormat()
            .map_err(|e| format!("GetMixFormat: {e}"))?
    };
    let mix = &*mix_format_ptr;
    let native_rate = mix.nSamplesPerSec;
    let native_channels = mix.nChannels;
    let bits = mix.wBitsPerSample;

    info!("WASAPI mix format: {native_rate} Hz, {native_channels} ch, {bits} bit");

    if native_rate != target_sample_rate {
        warn!(
            "Native mix rate {native_rate} Hz differs from target {target_sample_rate} Hz; \
             capturing at mix rate and resampling in the engine"
        );
    }

    let buffer_duration = REFTIMES_PER_SEC / 50; // 20ms
    let flags = if process_loopback {
        0
    } else {
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
    };

    audio_client
        .Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            flags,
            buffer_duration,
            0,
            mix_format_ptr,
            None,
        )
        .map_err(|e| {
            format!(
                "IAudioClient::Initialize failed: {e}. \
                 Ensure speakers/headphones are active and Windows privacy settings allow audio."
            )
        })?;

    let event = if process_loopback {
        None
    } else {
        let event = CreateEventW(None, false, false, None)
            .map_err(|e| format!("CreateEventW: {e}"))?;
        audio_client
            .SetEventHandle(event)
            .map_err(|e| format!("SetEventHandle: {e}"))?;
        Some(event)
    };

    let capture: IAudioCaptureClient = audio_client
        .GetService()
        .map_err(|e| format!("GetService IAudioCaptureClient: {e}"))?;

    audio_client
        .Start()
        .map_err(|e| format!("IAudioClient::Start: {e}"))?;

    while !stop.load(Ordering::SeqCst) {
        if let Some(event) = event {
            let wait = WaitForSingleObject(event, 50);
            if wait != WAIT_OBJECT_0 {
                continue;
            }
        } else {
            // Process loopback: poll.
            std::thread::sleep(Duration::from_millis(10));
        }

        loop {
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
    if let Some(event) = event {
        let _ = CloseHandle(event);
    }
    if !process_loopback {
        CoTaskMemFree(Some(mix_format_ptr as *const _ as *const _));
    }
    Ok(())
}

unsafe fn convert_to_f32(
    data: *mut u8,
    frames: u32,
    channels: u16,
    format: &WAVEFORMATEX,
) -> Vec<f32> {
    let n = (frames as usize) * (channels as usize);
    let mut out = vec![0.0f32; n];

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

    let src = std::slice::from_raw_parts(data as *const f32, n);
    out.copy_from_slice(src);
    out
}

unsafe fn device_friendly_name(device: &IMMDevice) -> Option<String> {
    let store = device.OpenPropertyStore(STGM_READ).ok()?;
    let var = store.GetValue(&PKEY_Device_FriendlyName).ok()?;
    let bstr = windows::core::BSTR::try_from(&var).ok()?;
    let s = bstr.to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

unsafe fn process_image_name(pid: u32) -> Option<String> {
    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut buf = [0u16; 512];
    let mut size = buf.len() as u32;
    let ok = QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_WIN32,
        windows::core::PWSTR(buf.as_mut_ptr()),
        &mut size,
    );
    let _ = CloseHandle(handle);
    if ok.is_err() || size == 0 {
        return None;
    }
    let path = String::from_utf16_lossy(&buf[..size as usize]);
    Some(
        std::path::Path::new(&path)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or(path),
    )
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

#[allow(dead_code)]
fn _keep(b: BOOL, d: Duration, g: GUID) {
    let _ = (b, d, g);
}
