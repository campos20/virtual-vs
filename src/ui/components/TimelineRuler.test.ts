import { WAVEFORM_PIXELS_PER_SECOND } from "@/engine/waveform";
import { computeRulerTicks } from "./TimelineRuler";

describe("computeRulerTicks", () => {
  it("numbers bars from 1 on the click's grid when there is a tempo", () => {
    // 120 BPM in 4/4: a bar every 2 seconds.
    const ticks = computeRulerTicks(8, 120);
    expect(ticks.map((tick) => tick.x)).toEqual(
      [0, 2, 4, 6, 8].map((sec) => sec * WAVEFORM_PIXELS_PER_SECOND),
    );
    expect(ticks[0].label).toBe("1");
    expect(ticks[1].label).toBe("2");
  });

  it("marks every second when there is no tempo, labelling every 1s at this zoom", () => {
    const ticks = computeRulerTicks(3, undefined);
    expect(ticks.map((tick) => tick.label)).toEqual([
      "0:00",
      "0:01",
      "0:02",
      "0:03",
    ]);
  });

  it("keeps labels far enough apart not to overlap", () => {
    const labelled = computeRulerTicks(300, 240).filter(
      (tick) => tick.label !== undefined,
    );
    for (let i = 1; i < labelled.length; i++) {
      expect(labelled[i].x - labelled[i - 1].x).toBeGreaterThanOrEqual(36);
    }
  });

  it("stays bounded for a long, fast song", () => {
    const ticks = computeRulerTicks(20 * 60, 300);
    expect(ticks.length).toBeLessThanOrEqual(601);
    expect(ticks.some((tick) => tick.label !== undefined)).toBe(true);
  });

  it("draws nothing for an empty song", () => {
    expect(computeRulerTicks(0, 120)).toEqual([]);
  });
});
