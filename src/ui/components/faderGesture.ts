/**
 * The maths behind the vertical fader, kept apart from the touch plumbing.
 *
 * PanResponder derives its gesture state from React Native's internal touch
 * history, which can't be driven meaningfully from a test - so the decisions
 * worth pinning down live here as plain functions instead.
 */

/** Unity gain - the value the track's reference tick marks, and where a double-tap resets to. */
export const UNITY_GAIN = 1;
/** Movement under this many pixels counts as a tap, not a drag. */
export const TAP_SLOP_PX = 6;
/** Two taps closer together than this are a double-tap. */
export const DOUBLE_TAP_MS = 300;

export type GestureEnd = "drag" | "tap" | "double-tap";

/**
 * Where the cap lands after the finger moved `dy` from where it grabbed.
 *
 * Relative to the grab point rather than absolute: reading the touch's
 * position instead means reading `locationY`, which is measured against
 * whichever view reports the touch and therefore shifts reference frame
 * mid-drag - the cause of the cap visibly jumping.
 */
export function valueFromDrag(
  startValue: number,
  dy: number,
  trackHeight: number,
  maxValue: number,
): number {
  if (trackHeight <= 0) return startValue;
  // Dragging up is a negative dy and should raise the level.
  const next = startValue - (dy / trackHeight) * maxValue;
  return Math.max(0, Math.min(maxValue, next));
}

/**
 * What a finished touch meant. `lastTapAt` is when the previous tap ended, or
 * 0 if the last gesture was a drag.
 */
export function classifyGestureEnd(
  dy: number,
  now: number,
  lastTapAt: number,
): GestureEnd {
  if (Math.abs(dy) > TAP_SLOP_PX) return "drag";
  if (lastTapAt > 0 && now - lastTapAt <= DOUBLE_TAP_MS) return "double-tap";
  return "tap";
}

/** At or below this gain the readout shows -∞ rather than an ever-larger negative number. */
const SILENCE_GAIN = 0.0001;

/** Linear gain to decibels relative to unity (1.0 = 0 dB). */
export function gainToDb(gain: number): number {
  return gain <= SILENCE_GAIN ? -Infinity : 20 * Math.log10(gain);
}

/** Decibels back to linear gain - the inverse of `gainToDb`. */
export function dbToGain(db: number): number {
  return db === -Infinity ? 0 : Math.pow(10, db / 20);
}

/**
 * The fader readout, the way a mixer prints it: one decimal, an explicit `+`
 * above unity, `-∞` at silence. Display only - the stored and engine value
 * stays the linear gain.
 */
export function formatDb(gain: number): string {
  const db = gainToDb(gain);
  if (db === -Infinity) return "-∞";
  const rounded = Math.round(db * 10) / 10;
  // Avoids printing "-0.0" for a gain a hair under unity.
  if (rounded === 0) return "0.0";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

/** Where the scale beside the fader puts its marks, in dB. `-Infinity` is the bottom. */
export const FADER_SCALE_DB = [0, -3, -6, -10, -20, -Infinity] as const;
