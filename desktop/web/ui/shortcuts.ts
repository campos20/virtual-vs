/**
 * The desktop app's keyboard shortcuts: which key does what, and the seek
 * targets for the ones that move the playhead. Pure - no DOM, no engine - so
 * it can be tested, and so the list users see (KeyboardShortcuts.tsx) is
 * generated from the same table the key handler matches against and can't
 * drift from it.
 *
 * Keys follow common DAW conventions: Space plays/pauses, Return stops and
 * returns to the start (Logic, Pro Tools), comma/period step by a bar
 * (Logic), K toggles the click (Logic), X opens the mixer (Logic), number
 * keys jump to markers (Reaper), up/down change song (MainStage).
 */
import type { SectionManifest } from "@/types/project";
import { BEATS_PER_BAR } from "@/ui/transportFormat";

export type ShortcutId =
  | "playPause"
  | "stop"
  | "toStart"
  | "barBack"
  | "barForward"
  | "fourBarsBack"
  | "fourBarsForward"
  | "previousMarker"
  | "nextMarker"
  | "marker"
  | "toggleClick"
  | "toggleMixer"
  | "toggleLyrics"
  | "previousSong"
  | "nextSong"
  | "help";

export interface ShortcutMatch {
  id: ShortcutId;
  /** For "marker": which marker, counting from 0 in time order. */
  markerIndex?: number;
}

/** The parts of a KeyboardEvent the matcher reads. */
export interface KeyEventLike {
  key: string;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/**
 * Which shortcut a key press means, if any. Matches on `key` (the character
 * typed), not `code` (the physical key), so "K" and "?" work on any keyboard
 * layout. Anything held with Cmd or Ctrl is left alone: those belong to the
 * system and the webview (quit, copy, reload…).
 */
export function matchShortcut(e: KeyEventLike): ShortcutMatch | null {
  if (e.metaKey || e.ctrlKey) return null;

  if (e.altKey) {
    if (e.shiftKey) return null;
    if (e.key === "ArrowLeft") return { id: "previousMarker" };
    if (e.key === "ArrowRight") return { id: "nextMarker" };
    return null;
  }

  if (e.key === "?") return { id: "help" };

  if (e.shiftKey) {
    if (e.key === "ArrowLeft") return { id: "fourBarsBack" };
    if (e.key === "ArrowRight") return { id: "fourBarsForward" };
    return null;
  }

  switch (e.key) {
    case " ":
      return { id: "playPause" };
    case "Enter":
      return { id: "stop" };
    case "Home":
      return { id: "toStart" };
    case "ArrowLeft":
    case ",":
      return { id: "barBack" };
    case "ArrowRight":
    case ".":
      return { id: "barForward" };
    case "ArrowUp":
      return { id: "previousSong" };
    case "ArrowDown":
      return { id: "nextSong" };
  }

  if (/^[1-9]$/.test(e.key)) {
    return { id: "marker", markerIndex: Number(e.key) - 1 };
  }

  switch (e.key.toLowerCase()) {
    case "k":
      return { id: "toggleClick" };
    case "x":
      return { id: "toggleMixer" };
    case "l":
      return { id: "toggleLyrics" };
  }
  return null;
}

/** Without a tempo there are no bars, so a "bar" step moves this far instead. */
export const NO_TEMPO_STEP_SEC = 5;
/**
 * Stepping back from just past a bar line goes to the bar before it, not
 * back to that same line - otherwise pressing it while playing would keep
 * landing on the line the playhead has only just crossed.
 */
const BACK_TOLERANCE_SEC = 0.25;

/**
 * Where a bar step lands. With a tempo it snaps to the click's bar lines
 * (bar 1 starts at 0, as in clickTrack.ts), like a DAW's grid; without one
 * it moves by NO_TEMPO_STEP_SEC per "bar". Never outside the song.
 */
export function barStepTarget(
  playheadSec: number,
  durationSec: number,
  bpm: number | undefined,
  bars: number,
): number {
  let target: number;
  if (bpm !== undefined && bpm > 0) {
    const barSec = (60 / bpm) * BEATS_PER_BAR;
    const position = playheadSec / barSec;
    // The epsilon keeps a playhead sitting exactly on a line from counting
    // as "before" it through floating-point noise.
    const current =
      bars > 0
        ? Math.floor(position + 1e-9)
        : Math.ceil(position - BACK_TOLERANCE_SEC / barSec - 1e-9);
    target = (current + bars) * barSec;
  } else {
    target = playheadSec + bars * NO_TEMPO_STEP_SEC;
  }
  return Math.max(0, Math.min(durationSec, target));
}

/**
 * Where "previous/next marker" lands, or null if there's no marker that way.
 * Previous uses the same tolerance as a bar step, so pressing it twice
 * while playing walks back marker by marker.
 */
export function markerStepTarget(
  playheadSec: number,
  sections: SectionManifest[],
  direction: -1 | 1,
): number | null {
  const starts = sections.map((s) => s.startSec).sort((a, b) => a - b);
  if (direction > 0) {
    return starts.find((start) => start > playheadSec + 1e-6) ?? null;
  }
  const before = starts.filter(
    (start) => start < playheadSec - BACK_TOLERANCE_SEC,
  );
  return before.length > 0 ? before[before.length - 1] : null;
}

/** The start of the marker a number key names (1 = first in time order), or null. */
export function markerIndexTarget(
  sections: SectionManifest[],
  index: number,
): number | null {
  const starts = sections.map((s) => s.startSec).sort((a, b) => a - b);
  return starts[index] ?? null;
}

export type ShortcutGroup = "transport" | "markers" | "song" | "help";

export interface ShortcutListing {
  id: ShortcutId;
  group: ShortcutGroup;
  /** Each entry is one way to press it; parts within an entry are pressed together. */
  keys: string[][];
}

const MAC_KEY_NAMES: Record<string, string> = {
  Alt: "⌥",
  Shift: "⇧",
  Enter: "Return",
};

/**
 * What the shortcut list shows, in display order. macOS gets its own key
 * names (⌥ for Alt, Return for Enter) so the list matches the keyboard in
 * front of the user.
 */
export function shortcutListing(isMac: boolean): ShortcutListing[] {
  const k = (name: string) => (isMac ? (MAC_KEY_NAMES[name] ?? name) : name);
  return [
    { id: "playPause", group: "transport", keys: [[k("Space")]] },
    { id: "stop", group: "transport", keys: [[k("Enter")]] },
    { id: "toStart", group: "transport", keys: [[k("Home")]] },
    { id: "barBack", group: "transport", keys: [["←"], [","]] },
    { id: "barForward", group: "transport", keys: [["→"], ["."]] },
    { id: "fourBarsBack", group: "transport", keys: [[k("Shift"), "←"]] },
    { id: "fourBarsForward", group: "transport", keys: [[k("Shift"), "→"]] },
    { id: "previousMarker", group: "markers", keys: [[k("Alt"), "←"]] },
    { id: "nextMarker", group: "markers", keys: [[k("Alt"), "→"]] },
    { id: "marker", group: "markers", keys: [["1 – 9"]] },
    { id: "previousSong", group: "song", keys: [["↑"]] },
    { id: "nextSong", group: "song", keys: [["↓"]] },
    { id: "toggleMixer", group: "song", keys: [["X"]] },
    { id: "toggleLyrics", group: "song", keys: [["L"]] },
    { id: "toggleClick", group: "song", keys: [["K"]] },
    { id: "help", group: "help", keys: [["?"]] },
  ];
}
