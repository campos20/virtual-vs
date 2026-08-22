import {
  DOUBLE_TAP_MS,
  TAP_SLOP_PX,
  UNITY_GAIN,
  classifyGestureEnd,
  valueFromDrag,
} from './faderGesture';

const HEIGHT = 200;
const MAX = 1.2;

describe('valueFromDrag', () => {
  // The bug this replaces: the position came from `locationY`, measured
  // against whichever view reported the touch, so the cap jumped whenever
  // that reference frame changed mid-drag.
  it('moves by exactly the distance the finger moved', () => {
    expect(valueFromDrag(0.5, -HEIGHT / 2, HEIGHT, MAX)).toBeCloseTo(0.5 + MAX / 2, 10);
    expect(valueFromDrag(0.8, HEIGHT / 4, HEIGHT, MAX)).toBeCloseTo(0.8 - MAX / 4, 10);
  });

  it('is relative to the grab value, not to where on the track it was grabbed', () => {
    // Same finger movement, different starting values -> same *delta*.
    const fromLow = valueFromDrag(0.2, -20, HEIGHT, MAX) - 0.2;
    const fromHigh = valueFromDrag(0.9, -20, HEIGHT, MAX) - 0.9;
    expect(fromLow).toBeCloseTo(fromHigh, 10);
  });

  it('does not move at all for a zero-distance touch', () => {
    expect(valueFromDrag(0.42, 0, HEIGHT, MAX)).toBe(0.42);
  });

  it('clamps to the ends instead of running past them', () => {
    expect(valueFromDrag(0.5, -HEIGHT * 10, HEIGHT, MAX)).toBe(MAX);
    expect(valueFromDrag(0.5, HEIGHT * 10, HEIGHT, MAX)).toBe(0);
  });

  // Layout hasn't landed yet - moving by an unknown fraction of an unknown
  // track would be worse than not moving.
  it('holds still if the track has not been measured', () => {
    expect(valueFromDrag(0.5, -50, 0, MAX)).toBe(0.5);
  });
});

describe('classifyGestureEnd', () => {
  it('calls a clear movement a drag', () => {
    expect(classifyGestureEnd(-40, 1000, 0)).toBe('drag');
    expect(classifyGestureEnd(TAP_SLOP_PX + 1, 1000, 0)).toBe('drag');
  });

  it('tolerates a little wobble in a tap', () => {
    expect(classifyGestureEnd(TAP_SLOP_PX - 1, 1000, 0)).toBe('tap');
  });

  it('calls a second quick tap a double-tap', () => {
    expect(classifyGestureEnd(0, 1000, 1000 - DOUBLE_TAP_MS + 10)).toBe('double-tap');
  });

  it('does not join two taps that are far apart in time', () => {
    expect(classifyGestureEnd(0, 5000, 1000)).toBe('tap');
  });

  // Otherwise a tap straight after a drag would read as a double-tap and
  // silently reset the channel the user just set.
  it('does not pair a tap with a preceding drag', () => {
    expect(classifyGestureEnd(0, 1000, 0)).toBe('tap');
  });

  it('resets to the marked unity line, not to silence', () => {
    expect(UNITY_GAIN).toBe(1);
  });
});
