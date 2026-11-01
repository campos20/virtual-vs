import { formatBarsBeats, formatTime } from "./transportFormat";

describe("formatTime", () => {
  it("prints minutes, seconds and tenths", () => {
    expect(formatTime(0)).toBe("0:00.0");
    expect(formatTime(83.47)).toBe("1:23.4");
  });

  it("clamps negative times to zero", () => {
    expect(formatTime(-2)).toBe("0:00.0");
  });
});

describe("formatBarsBeats", () => {
  it("starts at bar 1, beat 1", () => {
    expect(formatBarsBeats(0, 120)).toBe("1.1");
  });

  it("follows the click's 4/4 grid", () => {
    // 120 BPM: a beat every 0.5s, a bar every 2s.
    expect(formatBarsBeats(0.49, 120)).toBe("1.1");
    expect(formatBarsBeats(0.5, 120)).toBe("1.2");
    expect(formatBarsBeats(1.5, 120)).toBe("1.4");
    expect(formatBarsBeats(2, 120)).toBe("2.1");
    expect(formatBarsBeats(23.9, 120)).toBe("12.4");
  });

  it("prints nothing without a usable tempo", () => {
    expect(formatBarsBeats(10, 0)).toBe("");
    expect(formatBarsBeats(10, NaN)).toBe("");
  });
});
