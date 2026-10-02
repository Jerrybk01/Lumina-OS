//! Silence-based automatic segment splitting.

#[derive(Debug, Clone)]
pub struct SilenceSplitter {
    enabled: bool,
    threshold_linear: f32,
    required_silent_frames: u64,
    silent_frames: u64,
    in_silence: bool,
    /// True once we have observed real audio content in the current segment.
    had_audio: bool,
}

impl SilenceSplitter {
    pub fn new(enabled: bool, threshold_db: f32, duration_ms: u64, sample_rate: u32) -> Self {
        let threshold_linear = db_to_linear(threshold_db);
        let required_silent_frames =
            ((sample_rate as u64) * duration_ms.max(100) / 1000).max(1);
        Self {
            enabled,
            threshold_linear,
            required_silent_frames,
            silent_frames: 0,
            in_silence: false,
            had_audio: false,
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        self.silent_frames = 0;
        self.in_silence = false;
        self.had_audio = false;
    }

    /// Feed interleaved PCM. Returns `true` when a new segment should start
    /// (silence ended after a long enough quiet period with prior audio).
    pub fn process(&mut self, samples: &[f32], channels: u16) -> bool {
        if !self.enabled {
            return false;
        }
        let ch = channels.max(1) as usize;
        let frames = samples.len() / ch;
        let mut should_split = false;

        for i in 0..frames {
            let mut peak = 0.0f32;
            for c in 0..ch {
                peak = peak.max(samples[i * ch + c].abs());
            }

            if peak < self.threshold_linear {
                self.silent_frames = self.silent_frames.saturating_add(1);
                if self.had_audio && self.silent_frames >= self.required_silent_frames {
                    self.in_silence = true;
                }
            } else {
                if self.in_silence && self.had_audio {
                    should_split = true;
                    self.in_silence = false;
                    self.had_audio = false;
                    self.silent_frames = 0;
                }
                self.had_audio = true;
                self.silent_frames = 0;
            }
        }

        should_split
    }
}

fn db_to_linear(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_after_silence() {
        // 1000 Hz, 100ms silence required → 100 frames
        let mut s = SilenceSplitter::new(true, -40.0, 100, 1000);
        let loud = vec![0.5f32; 200]; // 100 stereo frames
        assert!(!s.process(&loud, 2));
        let quiet = vec![0.0f32; 220]; // 110 stereo frames of silence
        assert!(!s.process(&quiet, 2));
        assert!(s.process(&loud, 2));
    }
}
