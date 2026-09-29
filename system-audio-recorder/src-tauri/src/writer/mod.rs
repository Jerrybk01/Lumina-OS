//! FileWriter: multiplexes PCM into WAV or MP3 on disk.

mod mp3;
mod wav;

use std::path::{Path, PathBuf};

use chrono::Local;

use crate::audio::types::ExportFormat;

use mp3::Mp3FileWriter;
use wav::WavFileWriter;

#[derive(Debug, Clone)]
pub struct WriterConfig {
    pub output_dir: PathBuf,
    pub format: ExportFormat,
    pub sample_rate: u32,
    pub channels: u16,
    pub mp3_bitrate_kbps: u32,
}

pub enum FileWriter {
    Wav(WavFileWriter),
    Mp3(Mp3FileWriter),
}

impl FileWriter {
    pub fn create(cfg: WriterConfig, segment: u32) -> Result<Self, String> {
        let path = make_path(&cfg, segment);
        match cfg.format {
            ExportFormat::Wav => Ok(Self::Wav(WavFileWriter::create(
                &path,
                cfg.sample_rate,
                cfg.channels,
            )?)),
            ExportFormat::Mp3 => Ok(Self::Mp3(Mp3FileWriter::create(
                &path,
                cfg.sample_rate,
                cfg.channels,
                cfg.mp3_bitrate_kbps,
            )?)),
        }
    }

    pub fn write_samples(&mut self, samples: &[f32]) -> Result<u64, String> {
        match self {
            Self::Wav(w) => w.write_samples(samples),
            Self::Mp3(w) => w.write_samples(samples),
        }
    }

    pub fn finalize(&mut self) -> Result<(), String> {
        match self {
            Self::Wav(w) => w.finalize(),
            Self::Mp3(w) => w.finalize(),
        }
    }

    pub fn path(&self) -> &Path {
        match self {
            Self::Wav(w) => w.path(),
            Self::Mp3(w) => w.path(),
        }
    }
}

fn make_path(cfg: &WriterConfig, segment: u32) -> PathBuf {
    let stamp = Local::now().format("%Y%m%d-%H%M%S");
    let ext = match cfg.format {
        ExportFormat::Wav => "wav",
        ExportFormat::Mp3 => "mp3",
    };
    let name = if segment == 0 {
        format!("lumina-capture-{stamp}-{}.{}", cfg.sample_rate, ext)
    } else {
        format!(
            "lumina-capture-{stamp}-{}-seg{:03}.{}",
            cfg.sample_rate, segment, ext
        )
    };
    cfg.output_dir.join(name)
}
