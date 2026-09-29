//! Tauri command surface bridging the UI to AudioEngine / FileWriter.

use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::State;

use crate::audio::{
    AppAudioSource, AudioDeviceInfo, AudioEngine, CaptureCapabilities, MeterSnapshot,
    RecordSettings, SessionStats,
};

pub struct AppState {
    pub engine: Arc<AudioEngine>,
}

#[tauri::command]
pub fn get_capabilities(state: State<'_, AppState>) -> CaptureCapabilities {
    state.engine.capabilities()
}

#[tauri::command]
pub fn list_devices(state: State<'_, AppState>) -> Result<Vec<AudioDeviceInfo>, String> {
    state.engine.list_devices()
}

#[tauri::command]
pub fn list_app_sources(state: State<'_, AppState>) -> Result<Vec<AppAudioSource>, String> {
    state.engine.list_app_sources()
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> RecordSettings {
    state.engine.current_settings()
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    settings: RecordSettings,
) -> Result<(), String> {
    state.engine.update_settings(settings)
}

#[tauri::command]
pub fn start_recording(state: State<'_, AppState>) -> Result<SessionStats, String> {
    state.engine.start()
}

#[tauri::command]
pub fn pause_recording(state: State<'_, AppState>) -> Result<SessionStats, String> {
    state.engine.pause()
}

#[tauri::command]
pub fn stop_recording(state: State<'_, AppState>) -> Result<SessionStats, String> {
    state.engine.stop()
}

#[derive(Debug, Clone, Serialize)]
pub struct LiveSnapshot {
    pub meter: MeterSnapshot,
    pub stats: SessionStats,
}

#[tauri::command]
pub fn poll_live(state: State<'_, AppState>) -> LiveSnapshot {
    let (meter, stats) = state.engine.poll_live();
    LiveSnapshot { meter, stats }
}

#[tauri::command]
pub fn default_output_dir() -> String {
    dirs_next_home()
}

fn dirs_next_home() -> String {
    if let Some(mut d) = home_dir() {
        d.push("Music");
        d.push("Buka Quality Sound");
        let _ = std::fs::create_dir_all(&d);
        return d.display().to_string();
    }
    std::env::temp_dir().display().to_string()
}

fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
}

// Keep Mutex import used if we expand shared state.
#[allow(dead_code)]
type _Guard = Mutex<()>;
