import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { WAVEFORM_PIXELS_PER_SECOND } from "@/engine/waveform";
import type { SectionManifest } from "@/types/project";
import { monoFont, useThemeColors, type ThemeColors } from "@/ui/theme";
import { BEATS_PER_BAR } from "@/ui/transportFormat";
import { useTimelineScroll } from "./useTimelineScroll";

export const RULER_HEIGHT = 40;
/** Labels closer together than this would overlap. */
const MIN_LABEL_SPACING_PX = 36;
/** Ticks closer together than this are just noise. */
const MIN_TICK_SPACING_PX = 6;
/** Upper bound on tick views, whatever the song's length or tempo. */
const MAX_TICKS = 600;
const BAR_LABEL_STRIDES = [1, 2, 4, 8, 16, 32, 64];
const SECOND_LABEL_STRIDES = [1, 2, 5, 10, 15, 30, 60];

export interface RulerTick {
  x: number;
  /** Set on the ticks that carry a number. */
  label?: string;
}

function formatRulerSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Where the ruler's ticks go: one per bar (numbered from 1, on the click's
 * grid - see BEATS_PER_BAR) when the song has a tempo, one per second
 * otherwise. Labels and ticks thin out as they'd get too close, so the view
 * count stays bounded however long or fast the song is.
 */
export function computeRulerTicks(
  durationSec: number,
  bpm: number | undefined,
): RulerTick[] {
  if (durationSec <= 0) return [];
  const useBars = bpm !== undefined && bpm > 0;
  const unitSec = useBars ? (60 / bpm) * BEATS_PER_BAR : 1;
  const unitPx = unitSec * WAVEFORM_PIXELS_PER_SECOND;
  const strides = useBars ? BAR_LABEL_STRIDES : SECOND_LABEL_STRIDES;
  const count = Math.floor(durationSec / unitSec);
  const tickStride = Math.max(
    1,
    Math.ceil(MIN_TICK_SPACING_PX / unitPx),
    Math.ceil(count / MAX_TICKS),
  );
  const minLabelStride =
    strides.find((stride) => stride * unitPx >= MIN_LABEL_SPACING_PX) ??
    strides[strides.length - 1];
  // A multiple of the tick stride, so every label sits on a drawn tick.
  const labelStride = Math.ceil(minLabelStride / tickStride) * tickStride;

  const ticks: RulerTick[] = [];
  for (let i = 0; i <= count; i += tickStride) {
    const tick: RulerTick = { x: i * unitPx };
    if (i % labelStride === 0) {
      tick.label = useBars ? String(i + 1) : formatRulerSeconds(i);
    }
    ticks.push(tick);
  }
  return ticks;
}

interface TimelineRulerProps {
  durationSec: number;
  playheadSec: number;
  bpm?: number;
  sections: SectionManifest[];
}

/**
 * The time ruler above the arrange view's lanes, with the song's markers
 * flagged on it. Scrolls with the lanes by the same rule (see
 * `useTimelineScroll`) and is display only - seeking stays on the
 * transport's timeline and the Markers drawer, so a tap here can't move
 * the song by accident.
 */
export function TimelineRuler({
  durationSec,
  playheadSec,
  bpm,
  sections,
}: TimelineRulerProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { scrollRef, viewportWidth, onLayout } = useTimelineScroll(playheadSec);
  const contentWidth = Math.max(1, durationSec * WAVEFORM_PIXELS_PER_SECOND);

  const tickData = useMemo(
    () => computeRulerTicks(durationSec, bpm),
    [durationSec, bpm],
  );

  const ticks = useMemo(
    () =>
      tickData.map((tick) => (
        <View
          key={tick.x}
          style={[
            styles.tick,
            tick.label !== undefined && styles.tickMajor,
            { left: tick.x },
          ]}
        />
      )),
    [tickData, styles],
  );

  const labels = useMemo(
    () =>
      tickData
        .filter((tick) => tick.label !== undefined)
        .map((tick) => (
          <Text key={tick.x} style={[styles.label, { left: tick.x + 3 }]}>
            {tick.label}
          </Text>
        )),
    [tickData, styles],
  );

  return (
    <View style={styles.viewport} onLayout={onLayout}>
      {viewportWidth > 0 && (
        <ScrollView
          ref={scrollRef}
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: viewportWidth / 2 }}
        >
          <View style={{ width: contentWidth, height: RULER_HEIGHT }}>
            {ticks}
            {labels}
            {sections.map((section) => (
              <View
                key={section.id}
                style={[
                  styles.marker,
                  { left: section.startSec * WAVEFORM_PIXELS_PER_SECOND },
                ]}
              >
                <Text style={styles.markerText} numberOfLines={1}>
                  {section.name}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    viewport: {
      flex: 1,
      height: RULER_HEIGHT,
      overflow: "hidden",
    },
    tick: {
      position: "absolute",
      bottom: 0,
      width: StyleSheet.hairlineWidth * 2,
      height: 5,
      backgroundColor: colors.textTertiary,
    },
    tickMajor: {
      height: 12,
      backgroundColor: colors.textSecondary,
    },
    label: {
      position: "absolute",
      bottom: 1,
      color: colors.textSecondary,
      fontFamily: monoFont,
      fontSize: 10,
    },
    marker: {
      position: "absolute",
      top: 2,
      maxWidth: 120,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 2,
      backgroundColor: colors.warning,
    },
    markerText: {
      // `warning` is bright in dark mode, dark in light mode; `background`
      // inverts the same way, so the marker name stays legible on both.
      color: colors.background,
      fontSize: 10,
      fontWeight: "800",
    },
  });
}
