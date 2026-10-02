//! Lightweight spectral noise gate for optional noise reduction.
//!
//! This is a CPU-efficient single-band noise gate + soft expander intended for
//! content creators. It is not a full spectral denoiser; it reduces steady
//! hiss/hum floors without heavy FFT cost on the capture thread.

#[derive(Debug, Clone)]
pub struct NoiseReducer {
    enabled: bool,
    noise_floor: f32,
    attack: f32,
    release: f32,
    gain: f32,
    calibrated: bool,
    calib_frames: u32,
    calib_sum: f64,
}

impl NoiseReducer {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            noise_floor: 0.008,
            attack: 0.35,
            release: 0.08,
            gain: 1.0,
            calibrated: false,
            calib_frames: 0,
            calib_sum: 0.0,
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        if !enabled {
            self.gain = 1.0;
        }
    }

    pub fn process_inplace(&mut self, samples: &mut [f32], channels: u16) {
        if !self.enabled {
            return;
        }
        let ch = channels.max(1) as usize;
        let frames = samples.len() / ch;

        for i in 0..frames {
            let mut peak = 0.0f32;
            for c in 0..ch {
                peak = peak.max(samples[i * ch + c].abs());
            }

            // Auto-calibrate noise floor from first ~250ms of quiet material.
            if !self.calibrated {
                self.calib_sum += peak as f64;
                self.calib_frames += 1;
                if self.calib_frames >= 12_000 {
                    let mean = (self.calib_sum / self.calib_frames as f64) as f32;
                    self.noise_floor = (mean * 1.8).clamp(0.001, 0.05);
                    self.calibrated = true;
                }
            }

            let threshold = self.noise_floor * 2.5;
            let target = if peak < self.noise_floor {
                0.05
            } else if peak < threshold {
                let t = (peak - self.noise_floor) / (threshold - self.noise_floor);
                0.05 + t * 0.95
            } else {
                1.0
            };

            let coeff = if target < self.gain {
                self.release
            } else {
                self.attack
            };
            self.gain += (target - self.gain) * coeff;

            for c in 0..ch {
                samples[i * ch + c] *= self.gain;
            }
        }
    }
}
