import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useAppSelector } from "@/store/hooks";
import { trackEntityId } from "@/store/tracksSlice";
import type { SectionManifest } from "@/types/project";
import { radii, useThemeColors, type ThemeColors } from "@/ui/theme";
import { STEM_LANE_BAR_MAX_HEIGHT, StemWaveformLane } from "./StemWaveformLane";
import { TimelineRuler } from "./TimelineRuler";

export interface StemWaveform {
  id: string;
  name: string;
  color: string;
  peaks: Float32Array;
}

interface WaveformViewProps {
  projectId: string;
  tracks: StemWaveform[];
  durationSec: number;
  playheadSec: number;
  bpm?: number;
  sections: SectionManifest[];
}

const HEADER_WIDTH = 96;
const LANE_PADDING = 4;
const LANE_HEIGHT = STEM_LANE_BAR_MAX_HEIGHT + LANE_PADDING * 2;

/**
 * The arrange view: a ruler across the top, then one row per stem - its
 * track header on the left, its waveform region on the right - stacked and
 * vertically scrollable so a project with many stems doesn't run out of
 * screen height (nowPlayingStore caps this at 16 stems).
 *
 * Every lane and the ruler scroll horizontally in lockstep because they all
 * share the same duration and follow `playheadSec` by the same rule (see
 * `useTimelineScroll`). The playhead itself is drawn once here, as a line
 * spanning the ruler and every lane, centred on the timeline area to the
 * right of the headers.
 *
 * The track headers show mute/solo state but can't change it: on stage, a
 * stray tap in the main view must not mute a stem. Changing it stays in the
 * mixer, which takes a deliberate tap to open.
 */
export function WaveformView({
  projectId,
  tracks,
  durationSec,
  playheadSec,
  bpm,
  sections,
}: WaveformViewProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const trackStates = useAppSelector((s) => s.tracks.entities);

  const states = tracks.map(
    (track) => trackStates[trackEntityId(projectId, track.id)],
  );
  const anySoloed = states.some((state) => state?.soloed);

  return (
    <View style={styles.container}>
      <View style={styles.rulerRow}>
        <View style={styles.rulerCorner} />
        <TimelineRuler
          durationSec={durationSec}
          playheadSec={playheadSec}
          bpm={bpm}
          sections={sections}
        />
      </View>
      <ScrollView>
        {tracks.map((track, index) => {
          const state = states[index];
          const muted = state?.muted ?? false;
          const soloed = state?.soloed ?? false;
          const audible = !muted && (!anySoloed || soloed);
          return (
            <View
              key={track.id}
              style={[styles.row, index % 2 === 1 && styles.rowAlt]}
            >
              <View style={styles.header}>
                <View
                  style={[styles.headerColor, { backgroundColor: track.color }]}
                />
                <View style={styles.headerBody}>
                  <Text style={styles.headerName} numberOfLines={2}>
                    {track.name}
                  </Text>
                  <View style={styles.indicators}>
                    <View
                      style={[styles.indicator, muted && styles.indicatorMute]}
                    >
                      <Text
                        style={[
                          styles.indicatorText,
                          muted && styles.indicatorTextMute,
                        ]}
                      >
                        M
                      </Text>
                    </View>
                    <View
                      style={[styles.indicator, soloed && styles.indicatorSolo]}
                    >
                      <Text
                        style={[
                          styles.indicatorText,
                          soloed && styles.indicatorTextSolo,
                        ]}
                      >
                        S
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
              <View style={styles.lane}>
                <StemWaveformLane
                  color={track.color}
                  peaks={track.peaks}
                  durationSec={durationSec}
                  playheadSec={playheadSec}
                  dimmed={!audible}
                />
              </View>
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.playheadArea} pointerEvents="none">
        <View style={styles.playhead} />
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    rulerRow: {
      flexDirection: "row",
      backgroundColor: colors.panel,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rulerCorner: {
      width: HEADER_WIDTH,
      borderRightWidth: 1,
      borderRightColor: colors.border,
    },
    row: {
      flexDirection: "row",
      height: LANE_HEIGHT,
      backgroundColor: colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowAlt: {
      backgroundColor: colors.panel,
    },
    header: {
      width: HEADER_WIDTH,
      flexDirection: "row",
      backgroundColor: colors.panelRaised,
      borderRightWidth: 1,
      borderRightColor: colors.border,
    },
    headerColor: {
      width: 4,
    },
    headerBody: {
      flex: 1,
      paddingHorizontal: 6,
      paddingVertical: 4,
      justifyContent: "space-between",
    },
    headerName: {
      color: colors.textPrimary,
      fontSize: 11,
      fontWeight: "700",
    },
    indicators: {
      flexDirection: "row",
      gap: 3,
    },
    indicator: {
      width: 16,
      height: 13,
      borderRadius: 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    indicatorMute: {
      backgroundColor: colors.danger,
      borderColor: colors.danger,
    },
    indicatorSolo: {
      backgroundColor: colors.warning,
      borderColor: colors.warning,
    },
    indicatorText: {
      color: colors.textTertiary,
      fontSize: 8,
      fontWeight: "800",
    },
    indicatorTextMute: {
      color: "#ffffff",
    },
    // Same inversion as ChannelStrip's solo button text.
    indicatorTextSolo: {
      color: colors.background,
    },
    lane: {
      flex: 1,
      paddingVertical: LANE_PADDING,
    },
    // Spans exactly the timeline area (right of the headers), so the line at
    // its centre is the centre every lane and the ruler scroll to.
    playheadArea: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: HEADER_WIDTH,
      right: 0,
      alignItems: "center",
    },
    playhead: {
      width: 2,
      height: "100%",
      borderRadius: radii.sm,
      backgroundColor: colors.textPrimary,
    },
  });
}
