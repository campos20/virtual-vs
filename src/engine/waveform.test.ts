import { computeWaveformPeaks, waveformBarCount } from './waveform';

const SAMPLE_RATE = 100;

/** A minimal stand-in for the one `AudioBuffer` shape this module reads. */
function buffer(samples: number[], sampleRate = SAMPLE_RATE) {
  const data = new Float32Array(samples);
  return {
    numberOfChannels: 1,
    length: data.length,
    sampleRate,
    getChannelData: () => data,
  } as unknown as import('react-native-audio-api').AudioBuffer;
}

describe('waveformBarCount', () => {
  it('is zero for a zero or negative duration', () => {
    expect(waveformBarCount(0)).toBe(0);
    expect(waveformBarCount(-5)).toBe(0);
  });

  it('grows with duration but never exceeds the per-lane-count cap', () => {
    expect(waveformBarCount(1)).toBeGreaterThan(0);
    expect(waveformBarCount(10000)).toBeLessThanOrEqual(4000);
  });

  it('goes coarser as more lanes share the same total bar budget', () => {
    const oneLane = waveformBarCount(120, 1);
    const sixteenLanes = waveformBarCount(120, 16);

    expect(sixteenLanes).toBeLessThan(oneLane);
    expect(sixteenLanes).toBeGreaterThan(0);
  });

  it('never goes below the legibility floor even with many lanes', () => {
    expect(waveformBarCount(600, 16)).toBeGreaterThanOrEqual(150);
  });
});

describe('computeWaveformPeaks', () => {
  it('returns an all-zero array for a zero duration or bar count', () => {
    expect(computeWaveformPeaks([], 0, 0)).toHaveLength(0);
    expect(computeWaveformPeaks([buffer(new Array(10).fill(1))], 1, 0)).toHaveLength(0);
  });

  it('captures a loud sample within its bar and leaves the rest quiet', () => {
    // 1 second at 100Hz; a single spike partway through the buffer.
    const spikeIndex = 55;
    const samples = new Array(100).fill(0);
    samples[spikeIndex] = 0.9;
    const barCount = waveformBarCount(1);
    const peaks = computeWaveformPeaks([buffer(samples)], 1, barCount);

    const expectedBar = Math.floor((spikeIndex / SAMPLE_RATE / 1) * barCount);
    expect(peaks[expectedBar]).toBeCloseTo(0.9, 5);
    expect(peaks.filter((p) => p > 0)).toHaveLength(1);
  });

  it('takes the envelope across multiple buffers, not their sum', () => {
    const quiet = buffer(new Array(100).fill(0.2));
    const loud = buffer(new Array(100).fill(0.6));
    const peaks = computeWaveformPeaks([quiet, loud], 1, waveformBarCount(1));

    for (const p of peaks) expect(p).toBeCloseTo(0.6, 5);
  });

  it('stops contributing once a shorter buffer runs out, without stretching it', () => {
    // Duration is 1s, but this stem is only 300ms (30 samples @ 100Hz) long.
    const short = buffer(new Array(30).fill(0.7));
    const barCount = waveformBarCount(1);
    const peaks = computeWaveformPeaks([short], 1, barCount);
    const lastCoveredBar = Math.ceil((30 / SAMPLE_RATE / 1) * barCount) - 1;

    expect(peaks[0]).toBeGreaterThan(0);
    expect(peaks[lastCoveredBar]).toBeGreaterThan(0);
    expect(peaks[lastCoveredBar + 1]).toBe(0);
    expect(peaks[barCount - 1]).toBe(0);
  });

  it('never throws on an empty buffer', () => {
    expect(() => computeWaveformPeaks([buffer([])], 1, waveformBarCount(1))).not.toThrow();
  });
});
