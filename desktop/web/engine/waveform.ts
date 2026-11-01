/**
 * Desktop version of `src/engine/waveform.ts`. Everything is the mobile
 * module's (it's imported directly - metro.config.js doesn't redirect
 * imports made from desktop/web) except `computeWaveformPeaks`: on desktop
 * the samples stay in the Rust engine, which sends a fine-grained envelope
 * with each decoded stem; this folds that envelope into the bars the UI
 * draws, with the same per-bar maximum the mobile version computes.
 */
import type { AudioBuffer as DesktopAudioBuffer } from "../shims/react-native-audio-api";

// Everything else in the mobile module, unchanged. Listed explicitly so a
// new export there is a deliberate decision here too.
export {
  WAVEFORM_PIXELS_PER_SECOND,
  waveformBarCount,
} from "@/engine/waveform";

export function computeWaveformPeaks(
  buffers: unknown[],
  durationSec: number,
  barCount: number,
): Float32Array {
  const peaks = new Float32Array(Math.max(0, barCount));
  if (barCount <= 0 || durationSec <= 0) return peaks;
  const secondsPerBar = durationSec / barCount;

  for (const candidate of buffers) {
    const buffer = candidate as DesktopAudioBuffer;
    const envelope = buffer.peaks;
    if (!envelope || envelope.length === 0) continue;
    const perBar = secondsPerBar * buffer.peaksPerSecond;
    for (let bar = 0; bar < barCount; bar++) {
      const start = Math.floor(bar * perBar);
      if (start >= envelope.length) break;
      // At least one envelope point per bar, even when zoomed far in.
      const end = Math.min(
        envelope.length,
        Math.max(start + 1, Math.floor(start + perBar)),
      );
      let peak = peaks[bar];
      for (let i = start; i < end; i++) {
        if (envelope[i] > peak) peak = envelope[i];
      }
      peaks[bar] = peak;
    }
  }
  return peaks;
}
