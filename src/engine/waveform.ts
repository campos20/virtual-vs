import type { AudioBuffer } from 'react-native-audio-api';

/** Horizontal zoom: how many pixels of scrolling timeline represent one second of audio. */
export const WAVEFORM_PIXELS_PER_SECOND = 40;

const TARGET_BAR_WIDTH_PX = 2;
/**
 * Total bar (native view) budget shared across every visible stem lane, not
 * a per-lane cap - one waveform of a few thousand bars is cheap, but that
 * multiplied by up to 16 stem lanes would not be. Divided by lane count
 * below, so more stems means a coarser (but still proportionate) waveform
 * per lane rather than an unbounded view count.
 */
const MAX_TOTAL_BARS = 4000;
/** However many lanes are on screen, never go coarser than this - stays legible even with many stems. */
const MIN_BARS_PER_LANE = 150;
/** Peaks are found by striding through each bar's samples rather than scanning every one of them - bounds the work for a long recording instead of it scaling with sample count. */
const SAMPLES_PER_BAR_TARGET = 200;

/**
 * How many bars a waveform lane should render into, given the recording's
 * length and how many stem lanes are sharing the screen. Pass the same
 * `laneCount` to every lane so they all share one bar count and stay
 * time-aligned with each other and with the playhead.
 */
export function waveformBarCount(durationSec: number, laneCount = 1): number {
  if (durationSec <= 0 || laneCount <= 0) return 0;
  const desired = Math.round((durationSec * WAVEFORM_PIXELS_PER_SECOND) / TARGET_BAR_WIDTH_PX);
  const maxForLaneCount = Math.max(MIN_BARS_PER_LANE, Math.floor(MAX_TOTAL_BARS / laneCount));
  return Math.max(1, Math.min(desired, maxForLaneCount));
}

/**
 * One peak (0-1, occasionally a little over) per bar, taken as the loudest
 * of every buffer's first channel within that time slice - an envelope, not
 * a true mixdown, which is plenty for a visual timeline reference and far
 * cheaper to compute. Pass a single buffer for a per-stem lane, or several
 * to get one combined envelope. A buffer shorter than `durationSec` (a stem
 * that ends early) simply stops contributing once its samples run out,
 * rather than being time-stretched to fill every bar.
 */
export function computeWaveformPeaks(
  buffers: AudioBuffer[],
  durationSec: number,
  barCount: number
): Float32Array {
  const peaks = new Float32Array(Math.max(0, barCount));
  if (barCount <= 0 || durationSec <= 0) return peaks;

  const secondsPerBar = durationSec / barCount;

  for (const buffer of buffers) {
    if (buffer.numberOfChannels === 0 || buffer.length === 0) continue;
    const data = buffer.getChannelData(0);
    const samplesPerBar = secondsPerBar * buffer.sampleRate;
    const stride = Math.max(1, Math.floor(samplesPerBar / SAMPLES_PER_BAR_TARGET));

    for (let bar = 0; bar < barCount; bar++) {
      const start = Math.floor(bar * samplesPerBar);
      if (start >= buffer.length) break;
      const end = Math.min(buffer.length, Math.floor(start + samplesPerBar));

      let peak = peaks[bar];
      for (let i = start; i < end; i += stride) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
      peaks[bar] = peak;
    }
  }

  return peaks;
}
