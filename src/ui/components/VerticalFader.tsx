import { useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import {
  lcd,
  monoFont,
  radii,
  useThemeColors,
  type ThemeColors,
} from "@/ui/theme";
import {
  FADER_SCALE_DB,
  UNITY_GAIN,
  classifyGestureEnd,
  dbToGain,
  formatDb,
  valueFromDrag,
} from "./faderGesture";

const TRACK_HEIGHT = 260;

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
 *
 * The scale beside the track and the readout above it are in dB, the way a
 * mixer labels them. Both are display only: the fader still moves linearly
 * in gain, and the value it reports is the same linear gain as before.
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
      const next = valueFromDrag(
        startValueRef.current,
        dy,
        height,
        latest.current.maxValue,
      );
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
        case "drag":
          lastTapAtRef.current = 0;
          latest.current.onCommit(draggingValueRef.current);
          return;
        case "double-tap":
          lastTapAtRef.current = 0;
          resetToUnity();
          return;
        case "tap":
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
  const unityPercent =
    `${Math.min(100, (UNITY_GAIN / maxValue) * 100)}%` as const;

  return (
    <View style={styles.wrapper}>
      <View style={[styles.readout, dragging && { borderColor: accentColor }]}>
        <Text style={[styles.readoutText, dragging && { color: lcd.text }]}>
          {formatDb(displayValue)}
        </Text>
      </View>
      <View style={styles.body}>
        {/* Static dB scale, positioned on the same linear-gain axis the cap uses. */}
        <View style={styles.scale} pointerEvents="none">
          {FADER_SCALE_DB.map((db) => {
            const position = Math.min(1, dbToGain(db) / maxValue);
            return (
              <View
                key={db}
                style={[styles.scaleMark, { bottom: `${position * 100}%` }]}
              >
                <Text style={styles.scaleLabel}>
                  {db === -Infinity ? "∞" : Math.abs(db)}
                </Text>
                <View style={styles.scaleTick} />
              </View>
            );
          })}
        </View>
        <View
          style={styles.track}
          onLayout={handleLayout}
          testID={testID}
          {...panResponder.panHandlers}
        >
          <View style={styles.groove} pointerEvents="none" />
          {/* Unity-gain (0 dB) reference mark across the track. */}
          <View
            style={[styles.unityTick, { bottom: unityPercent }]}
            pointerEvents="none"
          />
          <View
            style={[
              styles.fill,
              { height: fillPercent, backgroundColor: accentColor },
            ]}
            pointerEvents="none"
          />
          <View
            style={[
              styles.cap,
              { bottom: fillPercent },
              dragging && { borderColor: accentColor },
            ]}
            pointerEvents="none"
          >
            <View style={[styles.capLine, { backgroundColor: accentColor }]} />
          </View>
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrapper: {
      alignItems: "center",
      width: "100%",
    },
    readout: {
      alignSelf: "stretch",
      backgroundColor: lcd.background,
      borderRadius: radii.sm,
      paddingVertical: 3,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: lcd.border,
    },
    readoutText: {
      color: lcd.textDim,
      fontFamily: monoFont,
      fontSize: 12,
      fontVariant: ["tabular-nums"],
      fontWeight: "600",
      textAlign: "center",
    },
    body: {
      flexDirection: "row",
      height: TRACK_HEIGHT,
    },
    scale: {
      width: 24,
      marginRight: 6,
    },
    scaleMark: {
      position: "absolute",
      right: 0,
      flexDirection: "row",
      alignItems: "center",
      // Centres the label's text on the mark rather than sitting above it.
      marginBottom: -6,
      height: 12,
    },
    scaleLabel: {
      color: colors.textTertiary,
      fontFamily: monoFont,
      fontSize: 9,
      marginRight: 2,
    },
    scaleTick: {
      width: 4,
      height: StyleSheet.hairlineWidth * 2,
      backgroundColor: colors.textTertiary,
    },
    track: {
      height: TRACK_HEIGHT,
      width: 36,
      borderRadius: radii.sm,
      backgroundColor: lcd.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderTopColor: colors.bevelDark,
    },
    groove: {
      position: "absolute",
      left: "50%",
      marginLeft: -2,
      top: 6,
      bottom: 6,
      width: 4,
      borderRadius: 1,
      backgroundColor: "#000000",
    },
    unityTick: {
      position: "absolute",
      left: 0,
      right: 0,
      height: 1,
      backgroundColor: "rgba(255,255,255,0.35)",
    },
    fill: {
      position: "absolute",
      left: "50%",
      marginLeft: -2,
      width: 4,
      bottom: 0,
      borderRadius: 1,
    },
    cap: {
      position: "absolute",
      left: -6,
      right: -6,
      height: 22,
      marginBottom: -11,
      borderRadius: radii.sm,
      backgroundColor: "#d8d8dc",
      borderWidth: 1,
      borderColor: "#8a8a90",
      borderTopColor: "#f4f4f6",
      borderBottomColor: "#5a5a60",
      alignItems: "center",
      justifyContent: "center",
    },
    capLine: {
      alignSelf: "stretch",
      height: 2,
    },
  });
}
