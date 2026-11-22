fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=macos/SCKAudioCapture.m");
        cc::Build::new()
            .file("macos/SCKAudioCapture.m")
            .flag("-fobjc-arc")
            .compile("buka_sck_audio_capture");
        println!("cargo:rustc-link-lib=framework=ScreenCaptureKit");
        println!("cargo:rustc-link-lib=framework=CoreMedia");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
    }

    tauri_build::build()
}
