//! Audio subsystem: types, metering, DSP, platform capture, and engine.

pub mod engine;
pub mod meter;
pub mod noise_reduce;
pub mod silence_split;
pub mod types;

#[cfg(windows)]
pub mod wasapi;

#[cfg(target_os = "macos")]
pub mod coreaudio;

#[cfg(target_os = "linux")]
pub mod linux;

pub use engine::AudioEngine;
pub use types::*;
