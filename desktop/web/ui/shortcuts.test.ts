import type { SectionManifest } from "@/types/project";
import {
  barStepTarget,
  markerIndexTarget,
  markerStepTarget,
  matchShortcut,
  NO_TEMPO_STEP_SEC,
  shortcutListing,
  type KeyEventLike,
} from "./shortcuts";

function key(k: string, mods: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key: k,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    ...mods,
  };
}

function section(id: string, startSec: number): SectionManifest {
  return { id, name: id, startSec };
}

describe("matchShortcut", () => {
  it.each([
    [" ", "playPause"],
    ["Enter", "stop"],
    ["Home", "toStart"],
    ["ArrowLeft", "barBack"],
    [",", "barBack"],
    ["ArrowRight", "barForward"],
    [".", "barForward"],
    ["ArrowUp", "previousSong"],
    ["ArrowDown", "nextSong"],
    ["k", "toggleClick"],
    ["K", "toggleClick"],
    ["x", "toggleMixer"],
    ["l", "toggleLyrics"],
    ["?", "help"],
  ])("maps %j to %s", (k, id) => {
    expect(matchShortcut(key(k))?.id).toBe(id);
  });

  it("maps number keys to markers, counting from 0", () => {
    expect(matchShortcut(key("1"))).toEqual({ id: "marker", markerIndex: 0 });
    expect(matchShortcut(key("9"))).toEqual({ id: "marker", markerIndex: 8 });
    expect(matchShortcut(key("0"))).toBeNull();
  });

  it("uses Shift for four-bar steps and Alt for markers", () => {
    expect(matchShortcut(key("ArrowLeft", { shiftKey: true }))?.id).toBe(
      "fourBarsBack",
    );
    expect(matchShortcut(key("ArrowRight", { shiftKey: true }))?.id).toBe(
      "fourBarsForward",
    );
    expect(matchShortcut(key("ArrowLeft", { altKey: true }))?.id).toBe(
      "previousMarker",
    );
    expect(matchShortcut(key("ArrowRight", { altKey: true }))?.id).toBe(
      "nextMarker",
    );
  });

  it("leaves anything held with Cmd or Ctrl to the system", () => {
    expect(matchShortcut(key(" ", { metaKey: true }))).toBeNull();
    expect(matchShortcut(key("k", { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key("x", { metaKey: true }))).toBeNull();
  });

  it("ignores unknown keys and stray modifier combinations", () => {
    expect(matchShortcut(key("q"))).toBeNull();
    expect(matchShortcut(key("Escape"))).toBeNull();
    expect(matchShortcut(key(" ", { shiftKey: true }))).toBeNull();
    expect(matchShortcut(key("k", { altKey: true }))).toBeNull();
    expect(
      matchShortcut(key("ArrowLeft", { altKey: true, shiftKey: true })),
    ).toBeNull();
  });
});

describe("barStepTarget", () => {
  // 120 bpm in 4/4: one bar is 2 seconds.
  const BPM = 120;

  it("steps forward to the next bar line", () => {
    expect(barStepTarget(0, 100, BPM, 1)).toBe(2);
    expect(barStepTarget(2.7, 100, BPM, 1)).toBe(4);
    expect(barStepTarget(4, 100, BPM, 1)).toBe(6);
  });

  it("steps back to the start of the current bar, or the one before when just past a line", () => {
    expect(barStepTarget(5, 100, BPM, -1)).toBe(4);
    // Only just past bar 3's line (4s): goes back to bar 2 instead.
    expect(barStepTarget(4.1, 100, BPM, -1)).toBe(2);
    expect(barStepTarget(4, 100, BPM, -1)).toBe(2);
  });

  it("steps four bars at a time", () => {
    expect(barStepTarget(1, 100, BPM, 4)).toBe(8);
    // From mid bar 5 (line at 8s): 8, 6, 4, 2.
    expect(barStepTarget(9, 100, BPM, -4)).toBe(2);
    expect(barStepTarget(5, 100, BPM, -4)).toBe(0);
  });

  it("moves by a fixed time without a tempo", () => {
    expect(barStepTarget(10, 100, undefined, 1)).toBe(10 + NO_TEMPO_STEP_SEC);
    expect(barStepTarget(10, 100, undefined, -1)).toBe(10 - NO_TEMPO_STEP_SEC);
  });

  it("never leaves the song", () => {
    expect(barStepTarget(0.5, 100, BPM, -1)).toBe(0);
    expect(barStepTarget(99, 100, BPM, 1)).toBe(100);
    expect(barStepTarget(2, 100, undefined, -1)).toBe(0);
  });
});

describe("markerStepTarget", () => {
  const sections = [section("b", 30), section("a", 10), section("c", 60)];

  it("finds the next marker after the playhead", () => {
    expect(markerStepTarget(0, sections, 1)).toBe(10);
    expect(markerStepTarget(10, sections, 1)).toBe(30);
    expect(markerStepTarget(60, sections, 1)).toBeNull();
  });

  it("finds the previous marker, skipping one the playhead has only just passed", () => {
    expect(markerStepTarget(45, sections, -1)).toBe(30);
    expect(markerStepTarget(30.1, sections, -1)).toBe(10);
    expect(markerStepTarget(5, sections, -1)).toBeNull();
  });
});

describe("markerIndexTarget", () => {
  it("numbers markers in time order, not the order they were saved in", () => {
    const sections = [section("b", 30), section("a", 10)];
    expect(markerIndexTarget(sections, 0)).toBe(10);
    expect(markerIndexTarget(sections, 1)).toBe(30);
    expect(markerIndexTarget(sections, 2)).toBeNull();
  });
});

describe("shortcutListing", () => {
  it("lists every shortcut the matcher knows, once", () => {
    const ids = shortcutListing(false).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(16);
  });

  it("uses macOS key names on a Mac", () => {
    const mac = shortcutListing(true);
    expect(mac.find((s) => s.id === "stop")!.keys).toEqual([["Return"]]);
    expect(mac.find((s) => s.id === "previousMarker")!.keys).toEqual([
      ["⌥", "←"],
    ]);
    const other = shortcutListing(false);
    expect(other.find((s) => s.id === "stop")!.keys).toEqual([["Enter"]]);
  });
});
