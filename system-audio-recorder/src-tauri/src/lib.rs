mod audio;
mod commands;
mod writer;

use std::sync::Arc;

use commands::AppState;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let engine = Arc::new(audio::AudioEngine::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState { engine })
        .invoke_handler(tauri::generate_handler![
            commands::get_capabilities,
            commands::list_devices,
            commands::list_app_sources,
            commands::get_settings,
            commands::update_settings,
            commands::start_recording,
            commands::pause_recording,
            commands::stop_recording,
            commands::poll_live,
            commands::default_output_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Buka Quality Sound");
}
