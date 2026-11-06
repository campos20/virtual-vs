import { downsamplePeaks } from "./StemOverview";

describe("downsamplePeaks", () => {
  it("keeps the loudest peak in each bucket, so short transients survive", () => {
    const peaks = new Float32Array([0.1, 0.9, 0.2, 0.2, 0.5, 0.1]);
    expect(Array.from(downsamplePeaks(peaks, 3))).toEqual([
      expect.closeTo(0.9),
      expect.closeTo(0.2),
      expect.closeTo(0.5),
    ]);
  });

  it("returns the peaks unchanged when they already fit", () => {
    const peaks = new Float32Array([0.1, 0.2]);
    expect(downsamplePeaks(peaks, 10)).toBe(peaks);
  });

  it("covers every input peak when the count doesn't divide evenly", () => {
    const peaks = new Float32Array([0, 0, 0, 0, 0, 0, 1]);
    const out = downsamplePeaks(peaks, 3);
    expect(out).toHaveLength(3);
    expect(out[2]).toBe(1);
  });

  it("returns nothing for an empty input or a zero width", () => {
    expect(downsamplePeaks(new Float32Array(0), 5)).toHaveLength(0);
    expect(downsamplePeaks(new Float32Array([1, 1]), 0)).toHaveLength(0);
  });
});
