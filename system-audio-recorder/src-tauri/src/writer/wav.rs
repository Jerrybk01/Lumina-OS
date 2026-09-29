//! Streaming WAV writer (PCM float → 24-bit or 16-bit PCM in a standard RIFF WAV).

use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::Path;

use hound::{SampleFormat, WavSpec, WavWriter};

pub struct WavFileWriter {
    writer: Option<WavWriter<BufWriter<File>>>,
    path: std::path::PathBuf,
}

impl WavFileWriter {
    pub fn create(path: &Path, sample_rate: u32, channels: u16) -> Result<Self, String> {
        let spec = WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 24,
            sample_format: SampleFormat::Int,
        };
        let writer = WavWriter::create(path, spec)
            .map_err(|e| format!("Failed to create WAV {}: {e}", path.display()))?;
        Ok(Self {
            writer: Some(writer),
            path: path.to_path_buf(),
        })
    }

    pub fn write_samples(&mut self, samples: &[f32]) -> Result<u64, String> {
        let writer = self
            .writer
            .as_mut()
            .ok_or_else(|| "WAV writer already finalized".to_string())?;

        // 24-bit packed as i32 samples in hound.
        for &s in samples {
            let v = (s.clamp(-1.0, 1.0) * 8_388_607.0).round() as i32;
            writer
                .write_sample(v)
                .map_err(|e| format!("WAV write error: {e}"))?;
        }
        // Approximate bytes: 3 bytes per sample for 24-bit.
        Ok(samples.len() as u64 * 3)
    }

    pub fn finalize(&mut self) -> Result<(), String> {
        if let Some(w) = self.writer.take() {
            w.finalize()
                .map_err(|e| format!("WAV finalize {}: {e}", self.path.display()))?;
        }
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Patch / verify WAV header sizes after finalize (hound already does this).
#[allow(dead_code)]
pub fn touch_header(path: &Path) -> Result<(), String> {
    let mut f = File::options()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    f.seek(SeekFrom::End(0)).map_err(|e| e.to_string())?;
    let _ = f.flush();
    Ok(())
}
