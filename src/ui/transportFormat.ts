/**
 * Readouts for the transport's LCD, as plain functions so they can be tested
 * without rendering anything.
 */

/** Beats per bar, matching the click: both engines accent every 4th beat from 0 (clickTrack.ts, click.rs). */
export const BEATS_PER_BAR = 4;

/** `m:ss.t` - minutes, seconds and tenths. */
export function formatTime(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = Math.floor(clamped % 60);
  const tenths = Math.floor((clamped - Math.floor(clamped)) * 10);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${tenths}`;
}

/**
 * `bar.beat`, both counted from 1, on the same grid the click plays: beat 0
 * at time 0, `BEATS_PER_BAR` beats to a bar. Display only - nothing is
 * scheduled from this.
 */
export function formatBarsBeats(seconds: number, bpm: number): string {
  if (!(bpm > 0)) return "";
  const beatIndex = Math.floor((Math.max(0, seconds) * bpm) / 60);
  const bar = Math.floor(beatIndex / BEATS_PER_BAR) + 1;
  const beat = (beatIndex % BEATS_PER_BAR) + 1;
  return `${bar}.${beat}`;
}
