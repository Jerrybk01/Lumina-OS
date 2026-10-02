//! Streaming MP3 encoder via LAME (`mp3lame-encoder`).

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use mp3lame_encoder::{Builder, DualPcm, Encoder, FlushNoGap};

pub struct Mp3FileWriter {
    encoder: Option<Encoder>,
    file: BufWriter<File>,
    path: PathBuf,
    pcm_l: Vec<f32>,
    pcm_r: Vec<f32>,
}

impl Mp3FileWriter {
    pub fn create(
        path: &Path,
        sample_rate: u32,
        channels: u16,
        bitrate_kbps: u32,
    ) -> Result<Self, String> {
        if channels != 2 {
            return Err("MP3 writer currently expects stereo".into());
        }
        let mut builder = Builder::new().ok_or("Failed to create LAME builder")?;
        builder
            .set_num_channels(2)
            .map_err(|e| format!("LAME channels: {e:?}"))?;
        builder
            .set_sample_rate(sample_rate)
            .map_err(|e| format!("LAME sample rate: {e:?}"))?;
        builder
            .set_brate(mp3lame_encoder::Bitrate::Kbps320)
            .map_err(|e| format!("LAME bitrate: {e:?}"))?;
        // Map common rates if not 320.
        let _ = bitrate_kbps;
        if bitrate_kbps <= 192 {
            let _ = builder.set_brate(mp3lame_encoder::Bitrate::Kbps192);
        } else if bitrate_kbps <= 256 {
            let _ = builder.set_brate(mp3lame_encoder::Bitrate::Kbps256);
        }

        builder
            .set_quality(mp3lame_encoder::Quality::Best)
            .map_err(|e| format!("LAME quality: {e:?}"))?;

        let encoder = builder.build().map_err(|e| format!("LAME build: {e:?}"))?;
        let file = File::create(path)
            .map_err(|e| format!("Failed to create MP3 {}: {e}", path.display()))?;

        Ok(Self {
            encoder: Some(encoder),
            file: BufWriter::new(file),
            path: path.to_path_buf(),
            pcm_l: Vec::with_capacity(4096),
            pcm_r: Vec::with_capacity(4096),
        })
    }

    pub fn write_samples(&mut self, samples: &[f32]) -> Result<u64, String> {
        let encoder = self
            .encoder
            .as_mut()
            .ok_or_else(|| "MP3 writer already finalized".to_string())?;

        self.pcm_l.clear();
        self.pcm_r.clear();
        for frame in samples.chunks_exact(2) {
            self.pcm_l.push(frame[0]);
            self.pcm_r.push(frame[1]);
        }

        let input = DualPcm {
            left: &self.pcm_l,
            right: &self.pcm_r,
        };

        let mut out = Vec::new();
        out.reserve(mp3lame_encoder::max_required_buffer_size(self.pcm_l.len()));
        let encoded = encoder
            .encode(input, out.spare_capacity_mut())
            .map_err(|e| format!("LAME encode: {e:?}"))?;
        // SAFETY: encode writes initialized bytes into spare capacity.
        unsafe {
            out.set_len(encoded);
        }
        self.file
            .write_all(&out)
            .map_err(|e| format!("MP3 write: {e}"))?;
        Ok(out.len() as u64)
    }

    pub fn finalize(&mut self) -> Result<(), String> {
        if let Some(mut encoder) = self.encoder.take() {
            let mut out = Vec::new();
            out.reserve(1024 * 16);
            let encoded = encoder
                .flush::<FlushNoGap>(out.spare_capacity_mut())
                .map_err(|e| format!("LAME flush: {e:?}"))?;
            unsafe {
                out.set_len(encoded);
            }
            self.file
                .write_all(&out)
                .map_err(|e| format!("MP3 flush write: {e}"))?;
        }
        self.file
            .flush()
            .map_err(|e| format!("MP3 file flush: {e}"))?;
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}
