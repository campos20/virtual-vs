import { useCallback, useRef } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { colors, glow, radii } from '@/ui/theme';

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
   * touch responder events, never during render; see VerticalFader.tsx for
   * the same pattern. */
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => seekFromLocationX(event.nativeEvent.locationX),
    onPanResponderMove: (event) => seekFromLocationX(event.nativeEvent.locationX),
  });
  /* eslint-enable react-hooks/refs */

  const progressPercent = `${Math.max(0, Math.min(1, playheadSec / Math.max(durationSec, 1))) * 100}%` as const;

  return (
    <View style={styles.container}>
      <View style={styles.scrubTrack} onLayout={handleLayout} {...panResponder.panHandlers}>
        <View style={[styles.scrubFill, { width: progressPercent }]} />
        <View style={[styles.scrubHead, { left: progressPercent }, isPlaying && glow(colors.accent, 6)]} />
      </View>

      <View style={styles.row}>
        <Pressable onPress={onStop} style={styles.stopButton} hitSlop={8} testID="stop-button">
          <View style={styles.stopIcon} />
        </Pressable>

        <View style={styles.readout}>
          <Text style={styles.time}>
            <Text style={styles.timePlayed}>{formatTime(playheadSec)}</Text>
            <Text style={styles.timeSep}> / </Text>
            {formatTime(durationSec)}
          </Text>
        </View>

        <View style={styles.playButtonWrap}>
          {isPlaying && <View style={[styles.playGlow, glow(colors.accent, 16)]} />}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 14,
    paddingBottom: 18,
    paddingHorizontal: 16,
    gap: 18,
  },
  scrubTrack: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: '#08080a',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.6)',
  },
  scrubFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  scrubHead: {
    position: 'absolute',
    top: -4,
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: colors.accent,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  readout: {
    backgroundColor: '#08080a',
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.bevelDark,
  },
  time: {
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  timePlayed: {
    color: colors.textPrimary,
  },
  timeSep: {
    color: colors.textTertiary,
  },
  stopButton: {
    width: 46,
    height: 46,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.bevelLight,
    borderBottomWidth: 2,
    borderBottomColor: colors.bevelDark,
  },
  stopIcon: {
    width: 15,
    height: 15,
    borderRadius: 3,
    backgroundColor: '#ffffff',
  },
  playButtonWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlow: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.accent,
  },
  playButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.5)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0,0,0,0.3)',
  },
  playTriangle: {
    width: 0,
    height: 0,
    marginLeft: 4,
    borderTopWidth: 11,
    borderBottomWidth: 11,
    borderLeftWidth: 18,
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
    height: 19,
    borderRadius: 1.5,
    backgroundColor: '#0a0a0a',
  },
});
