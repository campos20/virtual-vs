import { peakToHeight } from "./waveformScale";

describe("peakToHeight", () => {
  it("keeps silence empty and full scale full", () => {
    expect(peakToHeight(0)).toBe(0);
    expect(peakToHeight(1)).toBe(1);
  });

  it("lifts quiet material so it stays visible", () => {
    // -20 dBFS: a tenth of full scale would be nearly invisible in a lane.
    expect(peakToHeight(0.1)).toBeGreaterThan(0.2);
  });

  it("keeps louder peaks taller than quieter ones", () => {
    expect(peakToHeight(0.5)).toBeGreaterThan(peakToHeight(0.25));
    expect(peakToHeight(0.25)).toBeGreaterThan(peakToHeight(0.05));
  });

  it("clamps a peak a little over full scale, and ignores junk", () => {
    expect(peakToHeight(1.2)).toBe(1);
    expect(peakToHeight(-0.5)).toBe(0);
    expect(peakToHeight(Number.NaN)).toBe(0);
  });
});
