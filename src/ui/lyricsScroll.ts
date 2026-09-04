import type { LyricsSyncPoint } from '@/types/project';

/** Default/min/max/step for the lyrics view's user-adjustable font size - a device/performer preference, not a per-project one, see settingsSlice. */
export const DEFAULT_LYRICS_FONT_SIZE_PT = 18;
export const LYRICS_FONT_SIZE_MIN_PT = 14;
export const LYRICS_FONT_SIZE_MAX_PT = 30;
export const LYRICS_FONT_SIZE_STEP_PT = 2;

export function clampLyricsFontSize(pt: number): number {
  return Math.min(LYRICS_FONT_SIZE_MAX_PT, Math.max(LYRICS_FONT_SIZE_MIN_PT, pt));
}

export interface LyricsScrollAnchor {
  timeSec: number;
  scrollY: number;
}

/**
 * Turns the user's tapped corrections into a sorted list of (time, scrollY)
 * anchors, bookended by two implicit virtual anchors: (0, 0) - top of the
 * text at the start of the track - and (durationSec, maxScrollY) - bottom of
 * the text at the end. With zero taps, that's the whole list, which
 * reproduces plain duration-proportional scroll; each real tap only refines
 * the interpolation around it.
 *
 * A sync point whose line hasn't been measured yet (not present in
 * `lineOffsets` - e.g. the lyrics text changed since it was recorded) is
 * dropped rather than guessed at.
 */
export function buildLyricsScrollAnchors(
  syncPoints: LyricsSyncPoint[],
  lineOffsets: Record<number, number>,
  durationSec: number,
  maxScrollY: number
): LyricsScrollAnchor[] {
  const tapped = syncPoints
    .filter((p) => lineOffsets[p.lineIndex] !== undefined)
    .map((p) => ({
      timeSec: Math.max(0, Math.min(durationSec, p.timeSec)),
      scrollY: Math.max(0, Math.min(maxScrollY, lineOffsets[p.lineIndex])),
    }));

  return [{ timeSec: 0, scrollY: 0 }, ...tapped, { timeSec: durationSec, scrollY: maxScrollY }].sort(
    (a, b) => a.timeSec - b.timeSec
  );
}

/**
 * Piecewise-linear interpolation of scroll position across `anchors` at
 * `playheadSec` - this is what makes scrolling smooth between taps, and
 * (via `buildLyricsScrollAnchors`'s virtual boundary anchors) a plain
 * duration-proportional scroll when there are no taps at all.
 */
export function computeLyricsScrollY(playheadSec: number, anchors: LyricsScrollAnchor[]): number {
  if (anchors.length === 0) return 0;
  if (playheadSec <= anchors[0].timeSec) return anchors[0].scrollY;

  const last = anchors[anchors.length - 1];
  if (playheadSec >= last.timeSec) return last.scrollY;

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (playheadSec >= a.timeSec && playheadSec <= b.timeSec) {
      const span = b.timeSec - a.timeSec;
      if (span <= 0) return b.scrollY;
      const fraction = (playheadSec - a.timeSec) / span;
      return a.scrollY + fraction * (b.scrollY - a.scrollY);
    }
  }

  return last.scrollY;
}

/**
 * The "current" line for the karaoke-style active-line highlight: the
 * furthest-along tapped line at or before `playheadSec`, or `0` before the
 * first tap. Doubles as immediate visual confirmation that a tap registered.
 */
export function activeLyricsLineIndex(playheadSec: number, syncPoints: LyricsSyncPoint[]): number {
  let active = 0;
  let bestTime = -Infinity;
  for (const point of syncPoints) {
    if (point.timeSec <= playheadSec && point.timeSec > bestTime) {
      bestTime = point.timeSec;
      active = point.lineIndex;
    }
  }
  return active;
}
