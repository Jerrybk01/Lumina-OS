//! macOS Core Audio / ScreenCaptureKit loopback backend.
//!
//! Captures **system output** (not the microphone) via ScreenCaptureKit audio
//! (`capturesAudio`, microphone off). Linked Objective-C helper:
//! `macos/SCKAudioCapture.m` (compiled by `build.rs`).
//!
//! Requires **Screen Recording** permission. Per-app filtering uses SCK
//! shareable applications when the user selects a `pid:…` source.

#![cfg(target_os = "macos")]

use std::ffi::{c_char, c_void, CStr, CString};
use std::os::raw::c_int;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use crossbeam_channel::Sender;
use tracing::{error, info, warn};

use super::app_source::parse_app_source_pid;
use super::types::{AppAudioSource, AudioChunk, AudioDeviceInfo, CaptureCapabilities};

type BukaAudioCallback = Option<
    unsafe extern "C" fn(
        interleaved: *const f32,
        frames: u32,
        channels: u32,
        sample_rate: u32,
        userdata: *mut c_void,
    ),
>;

extern "C" {
    fn buka_sck_start(
        app_filter_utf8: *const c_char,
        sample_rate: u32,
        callback: BukaAudioCallback,
        userdata: *mut c_void,
        out_handle: *mut *mut c_void,
        err_buf: *mut c_char,
        err_buf_len: usize,
    ) -> c_int;

    fn buka_sck_stop(handle: *mut c_void);

    fn buka_sck_list_apps(
        ids_out: *mut *mut c_char,
        names_out: *mut *mut c_char,
        max_items: c_int,
        err_buf: *mut c_char,
        err_buf_len: usize,
    ) -> c_int;

    fn buka_sck_free_cstr(s: *mut c_char);
}

pub fn capabilities() -> CaptureCapabilities {
    CaptureCapabilities {
        platform: "macos".into(),
        loopback_backend: "ScreenCaptureKit audio (system output)".into(),
        per_app_selection: true,
        notes: "Records system output via ScreenCaptureKit — not the microphone. \
                Grant Screen Recording in System Settings → Privacy & Security. \
                Per-app filter lists running apps from SCShareableContent (macOS 13+)."
            .into(),
    }
}

pub fn list_loopback_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    // SCK captures the system mix for a display filter; expose a single clear target.
    Ok(vec![AudioDeviceInfo {
        id: "system-output".into(),
        name: "System Output (ScreenCaptureKit)".into(),
        is_loopback: true,
        is_default: true,
        sample_rates: vec![44_100, 48_000],
        channels: 2,
    }])
}

pub fn list_app_sources() -> Result<Vec<AppAudioSource>, String> {
    let mut apps = vec![AppAudioSource {
        id: "system".into(),
        name: "All system audio".into(),
        pid: None,
    }];
    match sck_list_applications() {
        Ok(extra) => apps.extend(extra),
        Err(e) => {
            warn!("SCK app list unavailable: {e}");
        }
    }
    Ok(apps)
}

pub struct CoreAudioCapture {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl CoreAudioCapture {
    pub fn start(
        _device_id: Option<String>,
        app_source_id: Option<String>,
        target_sample_rate: u32,
        tx: Sender<AudioChunk>,
    ) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);

        // Fail fast: try a short probe start/stop so the UI gets a permission error
        // instead of a silent "recording" session.
        validate_sck_available(app_source_id.as_deref(), target_sample_rate)?;

        let handle = thread::Builder::new()
            .name("sck-loopback".into())
            .spawn(move || {
                if let Err(e) =
                    sck_capture_loop(app_source_id, target_sample_rate, tx, stop_flag)
                {
                    error!("ScreenCaptureKit capture ended: {e}");
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

fn validate_sck_available(app_source_id: Option<&str>, sample_rate: u32) -> Result<(), String> {
    // List apps as a lightweight permission / SCK presence check. Empty list with
    // an error means SCK/content failed; empty list with Ok is still acceptable
    // (no apps, but "All system audio" works).
    match sck_list_applications() {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = (app_source_id, sample_rate);
            Err(format!(
                "{e}. Grant Screen Recording to Buka Quality Sound in \
                 System Settings → Privacy & Security, then restart the app."
            ))
        }
    }
}

fn sck_list_applications() -> Result<Vec<AppAudioSource>, String> {
    const MAX: usize = 256;
    let mut id_ptrs: Vec<*mut c_char> = vec![ptr::null_mut(); MAX];
    let mut name_ptrs: Vec<*mut c_char> = vec![ptr::null_mut(); MAX];
    let mut err = vec![0i8; 512];

    let n = unsafe {
        buka_sck_list_apps(
            id_ptrs.as_mut_ptr(),
            name_ptrs.as_mut_ptr(),
            MAX as c_int,
            err.as_mut_ptr(),
            err.len(),
        )
    };
    if n < 0 {
        let msg = unsafe { CStr::from_ptr(err.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        return Err(if msg.is_empty() {
            "ScreenCaptureKit application list failed".into()
        } else {
            msg
        });
    }

    let mut out = Vec::with_capacity(n as usize);
    for i in 0..(n as usize) {
        let id = unsafe {
            let p = id_ptrs[i];
            let s = if p.is_null() {
                String::new()
            } else {
                CStr::from_ptr(p).to_string_lossy().into_owned()
            };
            buka_sck_free_cstr(p);
            s
        };
        let name = unsafe {
            let p = name_ptrs[i];
            let s = if p.is_null() {
                String::new()
            } else {
                CStr::from_ptr(p).to_string_lossy().into_owned()
            };
            buka_sck_free_cstr(p);
            s
        };
        let pid = parse_app_source_pid(Some(&id));
        if !id.is_empty() {
            out.push(AppAudioSource { id, name, pid });
        }
    }
    Ok(out)
}

struct CallbackState {
    tx: Sender<AudioChunk>,
}

unsafe extern "C" fn on_audio(
    interleaved: *const f32,
    frames: u32,
    channels: u32,
    sample_rate: u32,
    userdata: *mut c_void,
) {
    if interleaved.is_null() || userdata.is_null() || frames == 0 || channels == 0 {
        return;
    }
    let state = &*(userdata as *const CallbackState);
    let len = (frames as usize) * (channels as usize);
    let samples = std::slice::from_raw_parts(interleaved, len).to_vec();
    let _ = state.tx.send(AudioChunk {
        samples,
        channels: channels as u16,
        sample_rate,
    });
}

fn sck_capture_loop(
    app_source_id: Option<String>,
    target_sample_rate: u32,
    tx: Sender<AudioChunk>,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    let filter = app_source_id
        .as_deref()
        .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("system"))
        .unwrap_or("system");
    info!(
        "Starting ScreenCaptureKit system-audio capture (filter={filter}, target {target_sample_rate} Hz)"
    );

    let filter_c = CString::new(filter).map_err(|e| format!("app filter: {e}"))?;
    let state = Box::new(CallbackState { tx });
    let state_ptr = Box::into_raw(state) as *mut c_void;

    let mut handle: *mut c_void = ptr::null_mut();
    let mut err = vec![0i8; 512];
    let rc = unsafe {
        buka_sck_start(
            filter_c.as_ptr(),
            target_sample_rate,
            Some(on_audio),
            state_ptr,
            &mut handle,
            err.as_mut_ptr(),
            err.len(),
        )
    };
    if rc != 0 || handle.is_null() {
        unsafe {
            drop(Box::from_raw(state_ptr as *mut CallbackState));
        }
        let msg = unsafe { CStr::from_ptr(err.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        return Err(if msg.is_empty() {
            format!("ScreenCaptureKit start failed (code {rc})")
        } else {
            msg
        });
    }

    while !stop.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }

    unsafe {
        buka_sck_stop(handle);
        drop(Box::from_raw(state_ptr as *mut CallbackState));
    }
    Ok(())
}
