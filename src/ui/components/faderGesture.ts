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

export type GestureEnd = 'drag' | 'tap' | 'double-tap';

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
  maxValue: number
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
export function classifyGestureEnd(dy: number, now: number, lastTapAt: number): GestureEnd {
  if (Math.abs(dy) > TAP_SLOP_PX) return 'drag';
  if (lastTapAt > 0 && now - lastTapAt <= DOUBLE_TAP_MS) return 'double-tap';
  return 'tap';
}
