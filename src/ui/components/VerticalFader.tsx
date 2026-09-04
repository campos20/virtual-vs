import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { glow, radii, useThemeColors, type ThemeColors } from '@/ui/theme';
import {
  UNITY_GAIN,
  classifyGestureEnd,
  valueFromDrag,
} from './faderGesture';

/**
 * The volume readout sits on a fixed dark, LCD-style surface regardless of
 * theme (see `readout`'s hardcoded background below) - not part of the
 * app's light/dark chrome. Its text must stay fixed too, or it silently
 * loses contrast in light mode, where `colors.textSecondary` is
 * recalibrated for a *light* surface this one never is (see TransportBar's
 * identical fix for its elapsed-time readout and scrub-progress fill).
 */
const FIXED_DARK_SURFACE_TEXT_SECONDARY = '#9b9b9d';

interface VerticalFaderProps {
  /** Committed value from the store; only reflected while not actively dragging. */
  value: number;
  maxValue?: number;
  /** Called on every touch move - should drive the engine directly, not the store. */
  onLiveChange: (value: number) => void;
  /** Called once on release - should dispatch the committed value to the store. */
  onCommit: (value: number) => void;
  disabled?: boolean;
  accentColor: string;
  /** Applied to the touch-handling track, so gestures can be driven in tests. */
  testID?: string;
}

/**
 * A vertical channel-strip fader (drag up = louder), built on React Native's
 * core `PanResponder` rather than react-native-gesture-handler - no extra
 * native view/handler registration, just this View's own touch responder
 * (see AGENTS.md "Stability over appearance"). While dragging, the cap
 * tracks touch position locally and calls `onLiveChange` on every move; the
 * store's committed `value` is only re-applied once the drag ends, so it
 * can't fight the live gesture.
 *
 * The drag is *relative*: the cap moves by however far the finger moved from
 * where it grabbed, rather than jumping to wherever the finger is. Two
 * reasons. Absolute positioning has to read `locationY`, which is measured
 * against whichever view reports the touch - so it shifts reference frame
 * mid-drag (and once the finger leaves the track entirely) and the cap
 * visibly jumps. And on stage, a stray tap on a fader should never slam that
 * channel to a new level; with relative dragging a tap moves nothing.
 *
 * Double-tapping resets the channel to unity, the marked line on the track.
 */
export function VerticalFader({
  value,
  maxValue = 1.2,
  onLiveChange,
  onCommit,
  disabled,
  accentColor,
  testID,
}: VerticalFaderProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const heightRef = useRef(0);
  const draggingValueRef = useRef(value);
  /** Value the finger grabbed at, which the drag delta is applied to. */
  const startValueRef = useRef(value);
  const lastTapAtRef = useRef(0);
  // Non-null while actively dragging (tracks touch position); null means
  // "not dragging", so display falls back to the committed `value` prop -
  // no effect needed to sync committed state into local state.
  const [liveValue, setLiveValue] = useState<number | null>(null);

  /**
   * The gesture handlers are built once (see below), so they can't close over
   * a given render's props - they read them from here. Synced in an effect
   * rather than during render: a touch can only arrive after the render has
   * been committed, so the effect has always run by then.
   */
  const latest = useRef({ value, maxValue, onLiveChange, onCommit, disabled });
  useEffect(() => {
    latest.current = { value, maxValue, onLiveChange, onCommit, disabled };
  });

  /**
   * Created exactly once. PanResponder keeps a gesture's origin (`y0`) and
   * its running `dy` inside the instance it hands to these handlers, so
   * building a new one every render - and a drag re-renders on every move -
   * throws that accumulation away: `dy` stops being the distance travelled
   * since the finger went down, and the cap lurches around mid-drag instead
   * of following it.
   */
  /* eslint-disable react-hooks/refs, react-hooks/purity, react-hooks/preserve-manual-memoization --
   * Everything in this block runs from native touch events, never during
   * render: the refs hold live gesture state that must not lag a render, and
   * Date.now() is read fresh to tell a double-tap from two separate taps.
   * The empty dep list is load-bearing rather than an optimisation - see the
   * comment above - so the compiler must not be allowed to rebuild it. */
  const panResponder = useMemo(() => {
    function applyDelta(dy: number) {
      const height = heightRef.current;
      if (height <= 0) return;
      const next = valueFromDrag(startValueRef.current, dy, height, latest.current.maxValue);
      draggingValueRef.current = next;
      setLiveValue(next);
      latest.current.onLiveChange(next);
    }

    function resetToUnity() {
      const unity = Math.min(UNITY_GAIN, latest.current.maxValue);
      draggingValueRef.current = unity;
      latest.current.onLiveChange(unity);
      latest.current.onCommit(unity);
    }

    /** A double-tap resets, a drag commits, a lone tap changes nothing. */
    function endGesture(dy: number) {
      setLiveValue(null);
      const now = Date.now();

      switch (classifyGestureEnd(dy, now, lastTapAtRef.current)) {
        case 'drag':
          lastTapAtRef.current = 0;
          latest.current.onCommit(draggingValueRef.current);
          return;
        case 'double-tap':
          lastTapAtRef.current = 0;
          resetToUnity();
          return;
        case 'tap':
          // A single tap moved nothing, so there is nothing to write back -
          // this keeps a stray touch from rewriting the project's manifest.
          lastTapAtRef.current = now;
      }
    }

    return PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.disabled,
      onMoveShouldSetPanResponder: () => !latest.current.disabled,
      onPanResponderGrant: () => {
        // Grab from wherever the cap currently is - not from the touch point.
        const from = latest.current.value;
        startValueRef.current = draggingValueRef.current = from;
        setLiveValue(from);
      },
      onPanResponderMove: (_event, gesture) => applyDelta(gesture.dy),
      onPanResponderRelease: (_event, gesture) => endGesture(gesture.dy),
      onPanResponderTerminate: (_event, gesture) => endGesture(gesture.dy),
    });
  }, []);
  /* eslint-enable react-hooks/refs, react-hooks/purity, react-hooks/preserve-manual-memoization */

  function handleLayout(event: LayoutChangeEvent) {
    heightRef.current = event.nativeEvent.layout.height;
  }

  const dragging = liveValue !== null;
  const displayValue = liveValue ?? value;
  const ratio = Math.max(0, Math.min(1, displayValue / maxValue));
  const fillPercent = `${ratio * 100}%` as const;
  const unityPercent = `${Math.min(100, (1 / maxValue) * 100)}%` as const;

  return (
    <View style={styles.wrapper}>
      <View style={[styles.readout, dragging && glow(accentColor, 6)]}>
        <Text style={[styles.readoutText, dragging && { color: accentColor }]}>{Math.round(ratio * 100)}</Text>
      </View>
      <View
        style={styles.track}
        onLayout={handleLayout}
        testID={testID}
        {...panResponder.panHandlers}
      >
        <View style={styles.groove} pointerEvents="none" />
        {/* Unity-gain (1.0) reference mark, like the 0 dB tick on a real fader. */}
        <View style={[styles.unityTick, { bottom: unityPercent }]} pointerEvents="none" />
        <View style={[styles.fill, { height: fillPercent, backgroundColor: accentColor }]} pointerEvents="none" />
        <View
          style={[
            styles.cap,
            { bottom: fillPercent, borderColor: accentColor },
            dragging && glow(accentColor, 8),
          ]}
          pointerEvents="none"
        >
          <View style={styles.capRidge} />
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    width: '100%',
  },
  readout: {
    backgroundColor: '#08080a',
    borderRadius: radii.sm,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.bevelDark,
  },
  readoutText: {
    color: FIXED_DARK_SURFACE_TEXT_SECONDARY,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  track: {
    // Fixed throw rather than flex: a fader that stretches to the full
    // screen height has a uselessly long travel distance and doesn't read
    // as a mixer fader.
    height: 260,
    width: 36,
    borderRadius: radii.sm,
    backgroundColor: '#0a0a0c',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderTopColor: colors.bevelDark,
  },
  groove: {
    position: 'absolute',
    left: '50%',
    marginLeft: -2,
    top: 6,
    bottom: 6,
    width: 4,
    borderRadius: 2,
    backgroundColor: '#000000',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.8)',
  },
  unityTick: {
    position: 'absolute',
    left: -3,
    right: -3,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  fill: {
    position: 'absolute',
    left: '50%',
    marginLeft: -2,
    width: 4,
    bottom: 0,
    borderRadius: 2,
  },
  cap: {
    position: 'absolute',
    left: -8,
    right: -8,
    height: 18,
    marginBottom: -9,
    borderRadius: 4,
    backgroundColor: '#e8e8ea',
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capRidge: {
    width: '60%',
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  });
}
