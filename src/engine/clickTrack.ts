import type { AudioBuffer, BaseAudioContext } from 'react-native-audio-api';

const CLICK_DURATION_SEC = 0.015;
const CLICK_FREQ_HZ = 1800;
const ACCENT_FREQ_HZ = 2600;
const ACCENT_EVERY_BEATS = 4;

/**
 * Renders a full-length click track as a single AudioBuffer (silence with a
 * short decaying blip at every beat, an accented blip on beat 1 of each bar)
 * from the project's bpm. Used when a project has no click stem. Because
 * it's just another buffer, it schedules and stays sample-locked exactly
 * like any other stem - no separate per-beat scheduling logic needed.
 */
export function generateClickBuffer(
  context: BaseAudioContext,
  bpm: number,
  durationSec: number
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.max(1, Math.round(durationSec * sampleRate));
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  const secPerBeat = 60 / bpm;
  const clickSamples = Math.round(CLICK_DURATION_SEC * sampleRate);

  let beatIndex = 0;
  for (let startSec = 0; startSec < durationSec; startSec += secPerBeat, beatIndex++) {
    const startSample = Math.round(startSec * sampleRate);
    const accented = beatIndex % ACCENT_EVERY_BEATS === 0;
    const freq = accented ? ACCENT_FREQ_HZ : CLICK_FREQ_HZ;
    const amplitude = accented ? 0.9 : 0.55;

    for (let i = 0; i < clickSamples && startSample + i < length; i++) {
      const t = i / sampleRate;
      const envelope = 1 - i / clickSamples;
      data[startSample + i] += Math.sin(2 * Math.PI * freq * t) * envelope * amplitude;
    }
  }

  return buffer;
}
