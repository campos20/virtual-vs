import { useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { radii } from "@/ui/theme";
import { peakToHeight } from "@/ui/waveformScale";

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const MIN_BAR_HEIGHT = 1;

/**
 * Folds `peaks` down to `count` bars by taking the loudest peak in each
 * bucket, so a short transient isn't averaged away when zoomed out. Returns
 * `peaks` itself when it already fits.
 */
export function downsamplePeaks(
  peaks: Float32Array,
  count: number,
): Float32Array {
  const target = Math.max(0, Math.floor(count));
  if (target === 0 || peaks.length === 0) return new Float32Array(0);
  if (peaks.length <= target) return peaks;

  const out = new Float32Array(target);
  const bucket = peaks.length / target;
  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket));
    let max = 0;
    for (let j = start; j < end; j++) {
      if (peaks[j] > max) max = peaks[j];
    }
    out[i] = max;
  }
  return out;
}

interface StemOverviewProps {
  color: string;
  /** The stem's waveform peaks (0-1), covering the whole song. Absent while it isn't decoded - then just the tinted region shows. */
  peaks?: Float32Array;
  height: number;
}

/**
 * A stem's whole song at a glance, fitted to the available width - the
 * zoomed-out region a DAW's track list shows next to each track header.
 * Static: no playhead, no scrolling. Used by the song editor, where the point
 * is telling tracks apart, not following playback.
 */
export function StemOverview({ color, peaks, height }: StemOverviewProps) {
  const [width, setWidth] = useState(0);

  function onLayout(event: LayoutChangeEvent) {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  }

  const bars = useMemo(() => {
    if (!peaks || width <= 0) return null;
    const count = Math.floor(width / (BAR_WIDTH + BAR_GAP));
    return Array.from(downsamplePeaks(peaks, count), (peak, index) => (
      <View
        key={index}
        style={[
          styles.bar,
          {
            height: Math.max(MIN_BAR_HEIGHT, peakToHeight(peak) * (height - 4)),
            backgroundColor: color,
          },
        ]}
      />
    ));
  }, [peaks, width, height, color]);

  return (
    <View
      style={[
        styles.region,
        {
          height,
          // 8-digit hex: the track color as the region's tint and outline,
          // the same treatment as StemWaveformLane.
          backgroundColor: `${color}26`,
          borderColor: `${color}66`,
        },
      ]}
      onLayout={onLayout}
    >
      <View style={[styles.centerLine, { backgroundColor: `${color}59` }]} />
      {bars}
    </View>
  );
}

const styles = StyleSheet.create({
  region: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  centerLine: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    height: StyleSheet.hairlineWidth,
  },
  bar: {
    width: BAR_WIDTH,
    marginRight: BAR_GAP,
    borderRadius: 0.5,
  },
});
