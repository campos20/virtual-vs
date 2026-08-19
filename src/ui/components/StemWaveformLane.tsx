import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { WAVEFORM_PIXELS_PER_SECOND } from '@/engine/waveform';
import { colors } from '@/ui/theme';

export const STEM_LANE_BAR_MAX_HEIGHT = 48;
const MIN_BAR_HEIGHT = 2;
const BAR_GAP = 1;

interface StemWaveformLaneProps {
  label: string;
  color: string;
  /** One peak (0-1) per bar, from `computeWaveformPeaks` - same bar count/duration as every other lane, so they stay time-aligned. */
  peaks: Float32Array;
  durationSec: number;
  playheadSec: number;
}

/**
 * One stem's waveform: a static bar chart that scrolls horizontally under a
 * shared, externally-drawn playhead as the transport advances (see
 * WaveformView, which stacks several of these and owns the playhead line).
 * Scroll position is driven imperatively off the same throttled playhead
 * value TransportBar's scrub head already re-renders from (~15fps, see
 * usePlayhead) via ScrollView.scrollTo - no gesture-handler/reanimated
 * involved (see AGENTS.md "Stability over appearance"). The bars themselves
 * are memoized so that 15fps playhead prop churn only re-runs the
 * imperative scroll, not a reconciliation of every bar view.
 */
export function StemWaveformLane({ label, color, peaks, durationSec, playheadSec }: StemWaveformLaneProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ x: playheadSec * WAVEFORM_PIXELS_PER_SECOND, animated: false });
  }, [playheadSec]);

  const contentWidth = Math.max(1, durationSec * WAVEFORM_PIXELS_PER_SECOND);
  const barWidth = peaks.length > 0 ? contentWidth / peaks.length : 0;

  const bars = useMemo(
    () =>
      Array.from(peaks, (peak, index) => (
        <View
          key={index}
          style={[
            styles.bar,
            {
              width: Math.max(1, barWidth - BAR_GAP),
              marginRight: BAR_GAP,
              height: Math.max(MIN_BAR_HEIGHT, Math.min(1, peak) * STEM_LANE_BAR_MAX_HEIGHT),
              backgroundColor: color,
            },
          ]}
        />
      )),
    [peaks, barWidth, color]
  );

  return (
    <View style={styles.lane}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.viewport} onLayout={handleLayout}>
        {viewportWidth > 0 && (
          <ScrollView
            ref={scrollRef}
            horizontal
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.content, { paddingHorizontal: viewportWidth / 2 }]}
          >
            {bars}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lane: {
    marginBottom: 10,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
    marginLeft: 4,
  },
  viewport: {
    height: STEM_LANE_BAR_MAX_HEIGHT,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bar: {
    borderRadius: 1,
  },
});
