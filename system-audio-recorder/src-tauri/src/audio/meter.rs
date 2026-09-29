//! Peak / RMS metering and clipping detection (lock-free friendly).

use super::types::{MeterSnapshot, CLIP_THRESHOLD};

pub struct PeakMeter {
    peak_l: f32,
    peak_r: f32,
    sum_sq_l: f64,
    sum_sq_r: f64,
    count: u64,
    clip_count: u64,
    waveform: Vec<f32>,
    wave_write: usize,
    wave_acc: f32,
    wave_acc_n: u32,
    samples_per_bin: u32,
}

impl PeakMeter {
    pub fn new(waveform_bins: usize, sample_rate: u32) -> Self {
        // Aim for ~60 UI refreshes of history covering ~2s.
        let bins = waveform_bins.max(32);
        let samples_per_bin = ((sample_rate as f32 * 2.0) / bins as f32).round().max(1.0) as u32;
        Self {
            peak_l: 0.0,
            peak_r: 0.0,
            sum_sq_l: 0.0,
            sum_sq_r: 0.0,
            count: 0,
            clip_count: 0,
            waveform: vec![0.0; bins],
            wave_write: 0,
            wave_acc: 0.0,
            wave_acc_n: 0,
            samples_per_bin,
        }
    }

    pub fn process_interleaved(&mut self, samples: &[f32], channels: u16) {
        let ch = channels.max(1) as usize;
        let frames = samples.len() / ch;
        for i in 0..frames {
            let l = samples[i * ch].abs();
            let r = if ch > 1 {
                samples[i * ch + 1].abs()
            } else {
                l
            };

            if l > self.peak_l {
                self.peak_l = l;
            }
            if r > self.peak_r {
                self.peak_r = r;
            }
            self.sum_sq_l += (l as f64) * (l as f64);
            self.sum_sq_r += (r as f64) * (r as f64);
            self.count += 1;

            if l >= CLIP_THRESHOLD || r >= CLIP_THRESHOLD {
                self.clip_count += 1;
            }

            let mag = l.max(r);
            self.wave_acc = self.wave_acc.max(mag);
            self.wave_acc_n += 1;
            if self.wave_acc_n >= self.samples_per_bin {
                let idx = self.wave_write % self.waveform.len();
                self.waveform[idx] = self.wave_acc.clamp(0.0, 1.0);
                self.wave_write += 1;
                self.wave_acc = 0.0;
                self.wave_acc_n = 0;
            }
        }
    }

    /// Decay peaks slightly each snapshot so meters fall after loud transients.
    pub fn snapshot_and_decay(&mut self) -> MeterSnapshot {
        let n = self.count.max(1) as f64;
        let rms_l = (self.sum_sq_l / n).sqrt() as f32;
        let rms_r = (self.sum_sq_r / n).sqrt() as f32;
        let clipping = self.clip_count > 0;

        // Rotate waveform so newest samples are at the end.
        let len = self.waveform.len();
        let mut ordered = vec![0.0f32; len];
        for i in 0..len {
            ordered[i] = self.waveform[(self.wave_write + i) % len];
        }

        let snap = MeterSnapshot {
            peak_l: self.peak_l,
            peak_r: self.peak_r,
            rms_l,
            rms_r,
            waveform: ordered,
            clipping,
            clip_count: self.clip_count,
        };

        self.peak_l *= 0.82;
        self.peak_r *= 0.82;
        self.sum_sq_l = 0.0;
        self.sum_sq_r = 0.0;
        self.count = 0;
        snap
    }

    pub fn clip_count(&self) -> u64 {
        self.clip_count
    }

    pub fn reset_clips(&mut self) {
        self.clip_count = 0;
    }
}
