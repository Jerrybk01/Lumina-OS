#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    system_audio_recorder_lib::run();
}
