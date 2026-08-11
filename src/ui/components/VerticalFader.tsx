import { useCallback, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { colors, glow, radii } from '@/ui/theme';

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
}

/**
 * A vertical channel-strip fader (drag up = louder), built on React Native's
 * core `PanResponder` rather than react-native-gesture-handler - no extra
 * native view/handler registration, just this View's own touch responder
 * (see AGENTS.md "Stability over appearance"). While dragging, the cap
 * tracks touch position locally and calls `onLiveChange` on every move; the
 * store's committed `value` is only re-applied once the drag ends, so it
 * can't fight the live gesture.
 */
export function VerticalFader({ value, maxValue = 1.2, onLiveChange, onCommit, disabled, accentColor }: VerticalFaderProps) {
  const heightRef = useRef(0);
  const draggingValueRef = useRef(value);
  // Non-null while actively dragging (tracks touch position); null means
  // "not dragging", so display falls back to the committed `value` prop -
  // no effect needed to sync committed state into local state.
  const [liveValue, setLiveValue] = useState<number | null>(null);

  const updateFromLocationY = useCallback(
    (y: number) => {
      const height = heightRef.current;
      if (height <= 0) return;
      // y grows downward from the top of the track; louder = higher up = smaller y.
      const ratio = Math.max(0, Math.min(1, 1 - y / height));
      const next = ratio * maxValue;
      draggingValueRef.current = next;
      setLiveValue(next);
      onLiveChange(next);
    },
    [maxValue, onLiveChange]
  );

  /* eslint-disable react-hooks/refs -- these callbacks run on later native
   * touch responder events, never during render; reading refs synchronously
   * here (not React state) is what guarantees onPanResponderRelease/
   * Terminate see the very latest dragged value even if it fires faster
   * than React re-renders. */
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    onPanResponderGrant: (event) => updateFromLocationY(event.nativeEvent.locationY),
    onPanResponderMove: (event) => updateFromLocationY(event.nativeEvent.locationY),
    onPanResponderRelease: () => {
      setLiveValue(null);
      onCommit(draggingValueRef.current);
    },
    onPanResponderTerminate: () => {
      setLiveValue(null);
      onCommit(draggingValueRef.current);
    },
  });
  /* eslint-enable react-hooks/refs */

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
      <View style={styles.track} onLayout={handleLayout} {...panResponder.panHandlers}>
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

const styles = StyleSheet.create({
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
    color: colors.textSecondary,
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
