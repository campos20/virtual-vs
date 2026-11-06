import { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { WAVEFORM_PIXELS_PER_SECOND } from "@/engine/waveform";
import { radii } from "@/ui/theme";
import { peakToHeight } from "@/ui/waveformScale";
import { useTimelineScroll } from "./useTimelineScroll";

export const STEM_LANE_BAR_MAX_HEIGHT = 48;
const MIN_BAR_HEIGHT = 1;
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
 * Scrolling follows `useTimelineScroll`.
 *
 * Bars are mirrored around a centre line, scaled by `peakToHeight` so quiet
 * stems stay visible. The part already played gets a stronger tint behind
 * the bars, so where the song is reads at a glance.
 *
 * Performance: the bars are memoized, so the ~15fps playhead prop churn only
 * re-runs the imperative scroll and resizes the single "played" view - never
 * a reconciliation of every bar view. The view count is the bar count plus
 * three, whatever the playhead does.
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
  const playedWidth = Math.min(
    contentWidth,
    Math.max(0, playheadSec * WAVEFORM_PIXELS_PER_SECOND),
  );

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
                peakToHeight(peak) * (STEM_LANE_BAR_MAX_HEIGHT - 4),
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
            {/* Drawn before the bars, so both sit behind them. */}
            <View
              style={[
                styles.played,
                { width: playedWidth, backgroundColor: `${color}33` },
              ]}
            />
            <View
              style={[styles.centerLine, { backgroundColor: `${color}59` }]}
            />
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
  played: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
  },
  centerLine: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    height: StyleSheet.hairlineWidth,
  },
  bar: {
    borderRadius: 1,
  },
});
