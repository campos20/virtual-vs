import { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { WAVEFORM_PIXELS_PER_SECOND } from "@/engine/waveform";
import { radii } from "@/ui/theme";
import { useTimelineScroll } from "./useTimelineScroll";

export const STEM_LANE_BAR_MAX_HEIGHT = 48;
const MIN_BAR_HEIGHT = 2;
const BAR_GAP = 1;

interface StemWaveformLaneProps {
  color: string;
  /** One peak (0-1) per bar, from `computeWaveformPeaks` - same bar count/duration as every other lane, so they stay time-aligned. */
  peaks: Float32Array;
  durationSec: number;
  playheadSec: number;
  /** Drawn faded - the stem is muted, or another one is soloed. Display only. */
  dimmed?: boolean;
}

/**
 * One stem's waveform, drawn as a DAW-style region: a tinted block the
 * length of the stem with its waveform inside, scrolling horizontally under
 * a shared, externally-drawn playhead (see WaveformView, which stacks
 * several of these beside their track headers and owns the playhead line).
 * Scrolling follows `useTimelineScroll`. The bars are memoized so the
 * ~15fps playhead prop churn only re-runs the imperative scroll, not a
 * reconciliation of every bar view.
 */
export function StemWaveformLane({
  color,
  peaks,
  durationSec,
  playheadSec,
  dimmed,
}: StemWaveformLaneProps) {
  const { scrollRef, viewportWidth, onLayout } = useTimelineScroll(playheadSec);

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
              height: Math.max(
                MIN_BAR_HEIGHT,
                Math.min(1, peak) * (STEM_LANE_BAR_MAX_HEIGHT - 4),
              ),
              backgroundColor: color,
            },
          ]}
        />
      )),
    [peaks, barWidth, color],
  );

  return (
    <View
      style={[styles.viewport, dimmed && styles.dimmed]}
      onLayout={onLayout}
    >
      {viewportWidth > 0 && (
        <ScrollView
          ref={scrollRef}
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: viewportWidth / 2 }}
        >
          {/* 8-digit hex: the track color at ~15% opacity, the region's tint. */}
          <View
            style={[
              styles.region,
              { width: contentWidth, backgroundColor: `${color}26` },
              { borderColor: `${color}66` },
            ]}
          >
            {bars}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    height: STEM_LANE_BAR_MAX_HEIGHT,
    justifyContent: "center",
    overflow: "hidden",
  },
  dimmed: {
    opacity: 0.3,
  },
  region: {
    height: STEM_LANE_BAR_MAX_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  bar: {
    borderRadius: 0.5,
  },
});
