import { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

interface TransportBarProps {
  isPlaying: boolean;
  playheadSec: number;
  durationSec: number;
  onPlayPause: () => void;
  onStop: () => void;
  onSeek: (seconds: number) => void;
}

function formatTime(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = Math.floor(clamped % 60);
  const tenths = Math.floor((clamped - Math.floor(clamped)) * 10);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
}

export function TransportBar({ isPlaying, playheadSec, durationSec, onPlayPause, onStop, onSeek }: TransportBarProps) {
  const widthRef = useRef(0);

  function handleLayout(event: LayoutChangeEvent) {
    widthRef.current = event.nativeEvent.layout.width;
  }

  const seekFromLocationX = useCallback(
    (x: number) => {
      const width = widthRef.current;
      if (width <= 0 || durationSec <= 0) return;
      const ratio = Math.max(0, Math.min(1, x / width));
      onSeek(ratio * durationSec);
    },
    [durationSec, onSeek]
  );

  /* eslint-disable react-hooks/refs -- these callbacks run on later native
   * gesture events, never during render; see VerticalFader.tsx for the same pattern. */
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onBegin((event) => seekFromLocationX(event.x))
    .onUpdate((event) => seekFromLocationX(event.x));
  /* eslint-enable react-hooks/refs */

  const progressPercent = `${Math.max(0, Math.min(1, playheadSec / Math.max(durationSec, 1))) * 100}%` as const;

  return (
    <View style={styles.container}>
      <GestureDetector gesture={pan}>
        <View style={styles.scrubTrack} onLayout={handleLayout}>
          <View style={[styles.scrubFill, { width: progressPercent }]} />
          <View style={[styles.scrubHead, { left: progressPercent }]} />
        </View>
      </GestureDetector>

      <View style={styles.row}>
        <Pressable onPress={onStop} style={styles.stopButton} hitSlop={8} testID="stop-button">
          <View style={styles.stopIcon} />
        </Pressable>

        <Text style={styles.time}>
          {formatTime(playheadSec)}
          <Text style={styles.timeSep}> / </Text>
          {formatTime(durationSec)}
        </Text>

        <Pressable onPress={onPlayPause} style={styles.playButton} hitSlop={8} testID="play-pause-button">
          {isPlaying ? (
            <View style={styles.pauseIcon} testID="pause-icon">
              <View style={styles.pauseBar} />
              <View style={styles.pauseBar} />
            </View>
          ) : (
            <View style={styles.playTriangle} testID="play-icon" />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 10,
    paddingBottom: 16,
    paddingHorizontal: 16,
    gap: 14,
  },
  scrubTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1c1c1e',
  },
  scrubFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#208AEF',
  },
  scrubHead: {
    position: 'absolute',
    top: -4,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: '#ffffff',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  time: {
    color: '#ffffff',
    fontVariant: ['tabular-nums'],
    fontSize: 17,
    fontWeight: '600',
    minWidth: 150,
    textAlign: 'center',
  },
  timeSep: {
    color: '#5f5f63',
  },
  stopButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#2c2c2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopIcon: {
    width: 15,
    height: 15,
    borderRadius: 3,
    backgroundColor: '#ffffff',
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#208AEF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playTriangle: {
    width: 0,
    height: 0,
    marginLeft: 4,
    borderTopWidth: 10,
    borderBottomWidth: 10,
    borderLeftWidth: 17,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: '#0a0a0a',
  },
  pauseIcon: {
    flexDirection: 'row',
    gap: 5,
  },
  pauseBar: {
    width: 5,
    height: 18,
    borderRadius: 1.5,
    backgroundColor: '#0a0a0a',
  },
});
