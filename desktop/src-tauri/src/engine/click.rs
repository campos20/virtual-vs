//! The synthesized metronome - a port of the mobile app's
//! `engine/clickTrack.ts`. Rendered as a full-length stem so it plays and
//! stays sample-locked exactly like any other voice.

use super::mixer::StemAudio;

const CLICK_DURATION_SEC: f64 = 0.015;
const CLICK_FREQ_HZ: f64 = 1800.0;
const ACCENT_FREQ_HZ: f64 = 2600.0;
const ACCENT_EVERY_BEATS: usize = 4;

pub fn generate_click(bpm: f64, frames: usize, sample_rate: u32) -> StemAudio {
    let rate = sample_rate as f64;
    let length = frames.max(1);
    let mut mono = vec![0.0f32; length];
    let duration_sec = length as f64 / rate;
    let sec_per_beat = 60.0 / bpm;
    let click_samples = (CLICK_DURATION_SEC * rate).round() as usize;

    let mut beat = 0usize;
    loop {
        // Multiplied rather than accumulated, so beat N lands on exactly the
        // same sample regardless of song length.
        let start_sec = beat as f64 * sec_per_beat;
        if start_sec >= duration_sec {
            break;
        }
        let start = (start_sec * rate).round() as usize;
        let accented = beat.is_multiple_of(ACCENT_EVERY_BEATS);
        let freq = if accented {
            ACCENT_FREQ_HZ
        } else {
            CLICK_FREQ_HZ
        };
        let amplitude = if accented { 0.9 } else { 0.55 };
        for i in 0..click_samples {
            let Some(sample) = mono.get_mut(start + i) else {
                break;
            };
            let t = i as f64 / rate;
            let envelope = 1.0 - i as f64 / click_samples as f64;
            *sample +=
                ((2.0 * std::f64::consts::PI * freq * t).sin() * envelope * amplitude) as f32;
        }
        beat += 1;
    }

    StemAudio::from_interleaved_stereo(mono.into_iter().flat_map(|s| [s, s]).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beats_land_on_the_grid() {
        let rate = 48_000;
        // 120 bpm -> a beat every 24000 frames.
        let click = generate_click(120.0, rate as usize * 3, rate);
        let s = click.samples();
        assert_eq!(click.frames(), 144_000);
        let energy = |frame: usize| (0..100).map(|i| s[(frame + i) * 2].abs()).sum::<f32>();
        assert!(energy(0) > 1.0);
        assert!(energy(24_000) > 1.0);
        assert!(energy(12_000) == 0.0);
    }
}
