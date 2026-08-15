import type { AudioBuffer, BaseAudioContext } from 'react-native-audio-api';

const STEREO = 2;
/** -3 dB, the conventional gain for folding a channel into both sides. */
const HALF_POWER = Math.SQRT1_2;

/**
 * Per-channel [leftGain, rightGain] for the layouts we can name. Anything not
 * listed here gets the generic fold below.
 */
const LAYOUT_GAINS: Record<number, [number, number][]> = {
  // Quad: L R Ls Rs
  4: [
    [1, 0],
    [0, 1],
    [HALF_POWER, 0],
    [0, HALF_POWER],
  ],
  // 5.1: L R C LFE Ls Rs (LFE dropped, as is standard for a stereo fold)
  6: [
    [1, 0],
    [0, 1],
    [HALF_POWER, HALF_POWER],
    [0, 0],
    [HALF_POWER, 0],
    [0, HALF_POWER],
  ],
  // 7.1: L R C LFE Rls Rrs Ls Rs (LFE dropped)
  8: [
    [1, 0],
    [0, 1],
    [HALF_POWER, HALF_POWER],
    [0, 0],
    [HALF_POWER, 0],
    [0, HALF_POWER],
    [HALF_POWER, 0],
    [0, HALF_POWER],
  ],
};

/**
 * Generic fold for channel counts we can't name: every channel goes to both
 * sides at equal power. It's not a spatially correct fold, but it can never
 * silently drop the only channel that had audio in it.
 */
function genericGains(channels: number): [number, number][] {
  const gain = 1 / Math.sqrt(channels);
  return Array.from({ length: channels }, () => [gain, gain] as [number, number]);
}

/**
 * Folds a decoded buffer down to stereo.
 *
 * We do this ourselves rather than letting the audio graph handle it. The
 * engine's buses end in a StereoPannerNode, and react-native-audio-api only
 * implements down-mixes for 2/4/6-channel input; anything else (7.1, and any
 * odd count) falls through to a "discrete" copy that keeps channels 1-2 and
 * throws the rest away. That is silent for real-world files whose audio isn't
 * on the front pair - a 7.1 export with everything on the centre channel
 * plays as nothing at all.
 *
 * Doing the fold here makes the result identical regardless of the library's
 * internal mixing rules, which is worth the one-time cost at load.
 */
export function foldToStereo(context: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  const channels = buffer.numberOfChannels;
  if (channels <= STEREO) return buffer;

  const sources = Array.from({ length: channels }, (_, channel) =>
    buffer.getChannelData(channel)
  );
  const { left, right } = mixChannelsToStereo(sources, buffer.length);

  const folded = context.createBuffer(STEREO, buffer.length, buffer.sampleRate);
  folded.copyToChannel(left, 0);
  folded.copyToChannel(right, 1);
  return folded;
}

/**
 * The mixing itself, split out from any AudioBuffer handling so it can be
 * tested directly - the library's Jest mock returns zeroed channel data and
 * ignores `copyToChannel`, so nothing can be asserted through a real buffer.
 */
export function mixChannelsToStereo(
  channelData: Float32Array[],
  frames: number
): { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> } {
  const gains = LAYOUT_GAINS[channelData.length] ?? genericGains(channelData.length);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);

  for (let channel = 0; channel < channelData.length; channel++) {
    const [leftGain, rightGain] = gains[channel];
    if (leftGain === 0 && rightGain === 0) continue;

    const source = channelData[channel];
    if (leftGain !== 0) {
      for (let i = 0; i < frames; i++) left[i] += source[i] * leftGain;
    }
    if (rightGain !== 0) {
      for (let i = 0; i < frames; i++) right[i] += source[i] * rightGain;
    }
  }

  // Summing channels can exceed full scale (quad at full level reaches 1.7),
  // which would clip audibly through FOH. Scale back only when it actually
  // overshoots, and scale both sides equally so the stereo image is kept.
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (peak > 1) {
    const correction = 1 / peak;
    for (let i = 0; i < frames; i++) {
      left[i] *= correction;
      right[i] *= correction;
    }
  }

  return { left, right };
}
