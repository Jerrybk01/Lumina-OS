//! Shared audio types used across AudioEngine, FileWriter, and UI bridge.

use serde::{Deserialize, Serialize};

pub const SAMPLE_RATE_44_1: u32 = 44_100;
pub const SAMPLE_RATE_48: u32 = 48_000;
pub const DEFAULT_CHANNELS: u16 = 2;
pub const CLIP_THRESHOLD: f32 = 0.99;
pub const DEFAULT_SILENCE_DB: f32 = -48.0;
pub const DEFAULT_SILENCE_MS: u64 = 1500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SampleRate {
    Hz44100,
    Hz48000,
}

impl SampleRate {
    pub fn hz(self) -> u32 {
        match self {
            Self::Hz44100 => SAMPLE_RATE_44_1,
            Self::Hz48000 => SAMPLE_RATE_48,
        }
    }

    pub fn from_hz(hz: u32) -> Option<Self> {
        match hz {
            SAMPLE_RATE_44_1 => Some(Self::Hz44100),
            SAMPLE_RATE_48 => Some(Self::Hz48000),
            _ => None,
        }
    }
}

impl Default for SampleRate {
    fn default() -> Self {
        Self::Hz48000
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Wav,
    Mp3,
}

impl Default for ExportFormat {
    fn default() -> Self {
        Self::Wav
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecorderState {
    Idle,
    Recording,
    Paused,
}

impl Default for RecorderState {
    fn default() -> Self {
        Self::Idle
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_loopback: bool,
    pub is_default: bool,
    pub sample_rates: Vec<u32>,
    pub channels: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppAudioSource {
    pub id: String,
    pub name: String,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureCapabilities {
    pub platform: String,
    pub loopback_backend: String,
    pub per_app_selection: bool,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeterSnapshot {
    pub peak_l: f32,
    pub peak_r: f32,
    pub rms_l: f32,
    pub rms_r: f32,
    /// Downsampled waveform magnitudes in 0..1 for UI drawing.
    pub waveform: Vec<f32>,
    pub clipping: bool,
    pub clip_count: u64,
}

impl Default for MeterSnapshot {
    fn default() -> Self {
        Self {
            peak_l: 0.0,
            peak_r: 0.0,
            rms_l: 0.0,
            rms_r: 0.0,
            waveform: vec![0.0; 128],
            clipping: false,
            clip_count: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStats {
    pub state: RecorderState,
    pub elapsed_ms: u64,
    pub bytes_written: u64,
    pub file_path: Option<String>,
    pub segment_index: u32,
    pub sample_rate: u32,
    pub format: ExportFormat,
    pub clipping: bool,
    pub clip_count: u64,
    pub error: Option<String>,
}

impl Default for SessionStats {
    fn default() -> Self {
        Self {
            state: RecorderState::Idle,
            elapsed_ms: 0,
            bytes_written: 0,
            file_path: None,
            segment_index: 0,
            sample_rate: SAMPLE_RATE_48,
            format: ExportFormat::Wav,
            clipping: false,
            clip_count: 0,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordSettings {
    pub sample_rate: SampleRate,
    pub format: ExportFormat,
    pub output_dir: String,
    pub device_id: Option<String>,
    pub app_source_id: Option<String>,
    pub noise_reduction: bool,
    pub auto_split: bool,
    pub silence_threshold_db: f32,
    pub silence_duration_ms: u64,
    pub mp3_bitrate_kbps: u32,
}

impl Default for RecordSettings {
    fn default() -> Self {
        Self {
            sample_rate: SampleRate::Hz48000,
            format: ExportFormat::Wav,
            output_dir: String::new(),
            device_id: None,
            app_source_id: None,
            noise_reduction: false,
            auto_split: false,
            silence_threshold_db: DEFAULT_SILENCE_DB,
            silence_duration_ms: DEFAULT_SILENCE_MS,
            mp3_bitrate_kbps: 320,
        }
    }
}

/// Interleaved f32 PCM chunk moved between capture thread and writer.
#[derive(Debug, Clone)]
pub struct AudioChunk {
    pub samples: Vec<f32>,
    pub channels: u16,
    pub sample_rate: u32,
}
