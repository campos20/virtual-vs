import { mixChannelsToStereo } from './downmix';

const FRAMES = 64;

/** `channels` arrays where only `loudChannel` carries a signal. */
function channelsWithSignalOn(count: number, loudChannel: number, level = 0.8) {
  return Array.from({ length: count }, (_, channel) =>
    new Float32Array(FRAMES).fill(channel === loudChannel ? level : 0)
  );
}

function peak(data: Float32Array): number {
  let max = 0;
  for (const sample of data) max = Math.max(max, Math.abs(sample));
  return max;
}

describe('mixChannelsToStereo', () => {
  // The real-world bug this fixes: a 7.1 export with the whole song on the
  // centre channel and digital silence on the front pair. The audio library
  // keeps only channels 1-2 for 8-channel input, so it played nothing at all.
  it('keeps a centre-only 7.1 file audible on both sides', () => {
    const { left, right } = mixChannelsToStereo(channelsWithSignalOn(8, 2), FRAMES);

    expect(peak(left)).toBeGreaterThan(0.5);
    expect(peak(right)).toBeGreaterThan(0.5);
  });

  it('keeps 7.1 front L and R on their own sides', () => {
    const onlyFrontLeft = mixChannelsToStereo(channelsWithSignalOn(8, 0, 0.5), FRAMES);
    expect(onlyFrontLeft.left[0]).toBeCloseTo(0.5, 5);
    expect(onlyFrontLeft.right[0]).toBe(0);

    const onlyFrontRight = mixChannelsToStereo(channelsWithSignalOn(8, 1, 0.5), FRAMES);
    expect(onlyFrontRight.left[0]).toBe(0);
    expect(onlyFrontRight.right[0]).toBeCloseTo(0.5, 5);
  });

  it('drops LFE from a 5.1 or 7.1 fold', () => {
    // LFE is channel 4 in both layouts and is conventionally not folded in.
    expect(peak(mixChannelsToStereo(channelsWithSignalOn(6, 3), FRAMES).left)).toBe(0);
    expect(peak(mixChannelsToStereo(channelsWithSignalOn(8, 3), FRAMES).left)).toBe(0);
  });

  it('folds 5.1 surrounds to their matching side', () => {
    const { left, right } = mixChannelsToStereo(channelsWithSignalOn(6, 4), FRAMES);
    expect(peak(left)).toBeGreaterThan(0);
    expect(peak(right)).toBe(0);
  });

  // A layout we can't name must never silently discard the one channel that
  // happened to carry the audio - that is exactly how the original bug
  // presented.
  it('never drops audio from an unnamed channel layout', () => {
    for (const count of [3, 5, 7]) {
      for (let loud = 0; loud < count; loud++) {
        const { left, right } = mixChannelsToStereo(channelsWithSignalOn(count, loud), FRAMES);

        expect(peak(left)).toBeGreaterThan(0);
        expect(peak(right)).toBeGreaterThan(0);
      }
    }
  });

  it('does not clip when every channel is at full scale', () => {
    for (const count of [4, 5, 6, 8]) {
      const allLoud = Array.from({ length: count }, () => new Float32Array(FRAMES).fill(1));
      const { left, right } = mixChannelsToStereo(allLoud, FRAMES);

      expect(peak(left)).toBeLessThanOrEqual(1);
      expect(peak(right)).toBeLessThanOrEqual(1);
    }
  });
});
