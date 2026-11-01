//! Stem decoding: any format symphonia reads, folded to stereo and resampled
//! to the output device's rate, so the mixer only ever deals with one layout
//! at one rate.

use std::fs::File;
use std::path::Path;

use rubato::audioadapter_buffers::owned::InterleavedOwned;
use rubato::{Fft, FixedSync, Resampler};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;

use super::mixer::StemAudio;

/// -3 dB, the conventional gain for folding a channel into both sides.
const HALF_POWER: f32 = std::f32::consts::FRAC_1_SQRT_2;

struct Decoded {
    /// Interleaved, `channels` per frame.
    samples: Vec<f32>,
    channels: usize,
    sample_rate: u32,
}

fn decode_file(path: &Path) -> Result<Decoded, String> {
    let file = File::open(path).map_err(|e| format!("Could not open {}: {e}", path.display()))?;
    let mss = MediaSourceStream::new(Box::new(file), MediaSourceStreamOptions::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|e| format!("Unsupported audio file {}: {e}", path.display()))?;

    let track = format
        .first_track_known_codec(TrackType::Audio)
        .ok_or_else(|| format!("No playable audio track in {}", path.display()))?;
    let track_id = track.id;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or_else(|| format!("No audio parameters in {}", path.display()))?
        .clone();

    // Gapless is on by default: encoder delay/padding is trimmed, so a
    // compressed stem lines up with its WAV siblings frame for frame.
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .map_err(|e| format!("No decoder for {}: {e}", path.display()))?;

    let mut samples: Vec<f32> = Vec::new();
    let mut packet_samples: Vec<f32> = Vec::new();
    let mut channels = params.channels.as_ref().map_or(0, |c| c.count());
    let mut sample_rate = params.sample_rate.unwrap_or(0);

    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(SymphoniaError::ResetRequired) => break,
            Err(e) => return Err(format!("Error reading {}: {e}", path.display())),
        };
        if packet.track_id != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(buffer) => {
                let spec = buffer.spec();
                channels = spec.channels().count();
                sample_rate = spec.rate();
                buffer.copy_to_vec_interleaved(&mut packet_samples);
                samples.extend_from_slice(&packet_samples);
            }
            // A corrupt packet costs a few ms of that stem - but dropping it
            // would shift every later sample earlier and desync the stem from
            // its siblings, so the gap is filled with silence instead.
            Err(SymphoniaError::DecodeError(_)) => {
                let frames = params.max_frames_per_packet.unwrap_or(0) as usize;
                samples.resize(samples.len() + frames * channels.max(1), 0.0);
            }
            Err(e) => return Err(format!("Error decoding {}: {e}", path.display())),
        }
    }

    if channels == 0 || sample_rate == 0 {
        return Err(format!("{} has no audio", path.display()));
    }
    Ok(Decoded {
        samples,
        channels,
        sample_rate,
    })
}

/// Per-channel (left, right) gains for layouts we can name - same table as
/// the mobile app's `storage/downmix.ts`.
fn layout_gains(channels: usize) -> Vec<(f32, f32)> {
    let h = HALF_POWER;
    match channels {
        4 => vec![(1.0, 0.0), (0.0, 1.0), (h, 0.0), (0.0, h)],
        6 => vec![
            (1.0, 0.0),
            (0.0, 1.0),
            (h, h),
            (0.0, 0.0),
            (h, 0.0),
            (0.0, h),
        ],
        8 => vec![
            (1.0, 0.0),
            (0.0, 1.0),
            (h, h),
            (0.0, 0.0),
            (h, 0.0),
            (0.0, h),
            (h, 0.0),
            (0.0, h),
        ],
        n => {
            let g = 1.0 / (n as f32).sqrt();
            vec![(g, g); n]
        }
    }
}

/// Folds any channel count to interleaved stereo. Mono is duplicated to both
/// sides; more than two channels use the mobile app's fold, scaled back only
/// if the sum overshoots full scale.
pub fn fold_to_stereo(samples: &[f32], channels: usize) -> Vec<f32> {
    match channels {
        1 => samples.iter().flat_map(|s| [*s, *s]).collect(),
        2 => samples.to_vec(),
        n => {
            let gains = layout_gains(n);
            let frames = samples.len() / n;
            let mut out = vec![0.0f32; frames * 2];
            let mut peak = 0.0f32;
            for frame in 0..frames {
                let (mut l, mut r) = (0.0, 0.0);
                for (ch, (gl, gr)) in gains.iter().enumerate() {
                    let s = samples[frame * n + ch];
                    l += s * gl;
                    r += s * gr;
                }
                out[frame * 2] = l;
                out[frame * 2 + 1] = r;
                peak = peak.max(l.abs()).max(r.abs());
            }
            if peak > 1.0 {
                let correction = 1.0 / peak;
                out.iter_mut().for_each(|s| *s *= correction);
            }
            out
        }
    }
}

fn resample_stereo(samples: Vec<f32>, from: u32, to: u32) -> Result<Vec<f32>, String> {
    if from == to {
        return Ok(samples);
    }
    let frames = samples.len() / 2;
    let mut resampler = Fft::<f32>::new(from as usize, to as usize, 1024, 2, FixedSync::Input)
        .map_err(|e| format!("Resampler setup failed: {e}"))?;
    let input = InterleavedOwned::new_from(samples, 2, frames)
        .map_err(|e| format!("Resampler input error: {e:?}"))?;
    // `process_all` trims the resampler's own delay, so every stem resampled
    // this way stays aligned with every other one.
    let output = resampler
        .process_all(&input, frames, None)
        .map_err(|e| format!("Resampling failed: {e}"))?;
    Ok(output.take_data())
}

/// Decodes one stem into the mixer's format at `target_rate`.
pub fn decode_stem(path: &Path, target_rate: u32) -> Result<StemAudio, String> {
    let decoded = decode_file(path)?;
    let stereo = fold_to_stereo(&decoded.samples, decoded.channels);
    let resampled = resample_stereo(stereo, decoded.sample_rate, target_rate)?;
    Ok(StemAudio::from_interleaved_stereo(resampled))
}

/// A coarse envelope for drawing waveforms: the loudest sample (of either
/// channel) in each window of `sample_rate / per_second` frames. The UI
/// resamples this to however many bars it draws, so the full audio never
/// has to cross into the webview.
pub fn peaks(stem: &StemAudio, sample_rate: u32, per_second: u32) -> Vec<f32> {
    let window = (sample_rate / per_second.max(1)).max(1) as usize;
    stem.interleaved()
        .chunks(window * 2)
        .map(|chunk| chunk.iter().fold(0.0f32, |peak, s| peak.max(s.abs())))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peaks_follow_the_envelope() {
        let mut samples = vec![0.0f32; 2000]; // 1000 frames at 1000 Hz
        samples[1] = -0.8; // frame 0, right channel
        samples[1500] = 0.3; // frame 750
        let stem = StemAudio::from_interleaved_stereo(samples);
        let p = peaks(&stem, 1000, 4); // 250-frame windows
        assert_eq!(p, vec![0.8, 0.0, 0.0, 0.3]);
    }

    #[test]
    fn mono_is_duplicated() {
        assert_eq!(fold_to_stereo(&[0.1, 0.2], 1), vec![0.1, 0.1, 0.2, 0.2]);
    }

    #[test]
    fn surround_center_lands_on_both_sides() {
        // 5.1 frame with audio only on the centre channel.
        let out = fold_to_stereo(&[0.0, 0.0, 0.5, 0.9, 0.0, 0.0], 6);
        assert!((out[0] - 0.5 * HALF_POWER).abs() < 1e-6);
        assert!((out[1] - 0.5 * HALF_POWER).abs() < 1e-6);
    }

    #[test]
    fn overshooting_fold_is_scaled_back() {
        let out = fold_to_stereo(&[1.0, 1.0, 1.0, 1.0], 4);
        let peak = out.iter().fold(0.0f32, |p, s| p.max(s.abs()));
        assert!((peak - 1.0).abs() < 1e-6);
    }

    #[test]
    fn resampling_keeps_duration() {
        let frames = 44_100;
        let input = vec![0.0f32; frames * 2];
        let out = resample_stereo(input, 44_100, 48_000).unwrap();
        let out_frames = out.len() / 2;
        assert!((out_frames as i64 - 48_000).abs() <= 2, "{out_frames}");
    }

    #[test]
    fn decodes_a_wav_file() {
        // Minimal 16-bit stereo WAV at 22050 Hz, 1000 frames of a constant.
        let rate = 22_050u32;
        let frames = 1000u32;
        let data_len = frames * 4;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&(rate * 4).to_le_bytes());
        bytes.extend_from_slice(&4u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for _ in 0..frames {
            bytes.extend_from_slice(&8192i16.to_le_bytes());
            bytes.extend_from_slice(&(-8192i16).to_le_bytes());
        }
        let path = std::env::temp_dir().join(format!("vvs-decode-{}.wav", std::process::id()));
        std::fs::write(&path, bytes).unwrap();

        let stem = decode_stem(&path, rate).unwrap();
        assert_eq!(stem.frames(), frames as usize);
        assert!((stem.samples()[0] - 0.25).abs() < 1e-3);
        assert!((stem.samples()[1] + 0.25).abs() < 1e-3);

        let resampled = decode_stem(&path, 44_100).unwrap();
        assert!((resampled.frames() as i64 - 2000).abs() <= 2);
        std::fs::remove_file(path).ok();
    }
}
