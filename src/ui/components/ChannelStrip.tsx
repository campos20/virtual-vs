import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { audioEngine } from "@/engine";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { persistProjectMixer } from "@/store/persistProject";
import {
  trackBusSet,
  trackEntityId,
  trackMuteToggled,
  trackSoloToggled,
  trackVolumeCommitted,
} from "@/store/tracksSlice";
import type { Bus, TrackManifest } from "@/types/project";
import { lcd, radii, useThemeColors, type ThemeColors } from "@/ui/theme";
import { getTrackColor } from "../trackColors";
import { VerticalFader } from "./VerticalFader";

// "cue"/"main" are the internal bus identifiers (see types/project.ts) - the
// cue bus is hard-panned left and the main bus hard-panned right (see
// AudioEngine), so L/R is what actually shows up here since that's the
// convention musicians read off a mixer.
const BUS_OPTIONS: { value: Bus; label: string }[] = [
  { value: "cue", label: "L" },
  { value: "main", label: "R" },
  { value: "both", label: "L+R" },
];

/** Text on a track-colored surface - the palette is all bright mid-tones, so dark text reads on every one in either theme. */
const ON_TRACK_COLOR_TEXT = "#111114";

interface ChannelStripProps {
  projectId: string;
  track: TrackManifest;
  index: number;
}

export function ChannelStrip({ projectId, track, index }: ChannelStripProps) {
  const dispatch = useAppDispatch();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const entityId = trackEntityId(projectId, track.id);
  const committed = useAppSelector((s) => s.tracks.entities[entityId]);
  const accentColor = getTrackColor(index);

  if (!committed) return null;

  function handleLiveVolume(volume: number) {
    audioEngine.setTrackVolume(track.id, volume);
  }

  // Each of these commits to the store and then writes the whole mixer back
  // to the project's manifest, so the mix is still there next time it opens.
  function handleCommitVolume(volume: number) {
    dispatch(trackVolumeCommitted({ projectId, trackId: track.id, volume }));
    dispatch(persistProjectMixer(projectId));
  }

  function toggleMute() {
    audioEngine.setTrackMuted(track.id, !committed!.muted);
    dispatch(trackMuteToggled({ projectId, trackId: track.id }));
    dispatch(persistProjectMixer(projectId));
  }

  function toggleSolo() {
    audioEngine.setTrackSoloed(track.id, !committed!.soloed);
    dispatch(trackSoloToggled({ projectId, trackId: track.id }));
    dispatch(persistProjectMixer(projectId));
  }

  function setBus(bus: Bus) {
    audioEngine.setTrackBus(track.id, bus);
    dispatch(trackBusSet({ projectId, trackId: track.id, bus }));
    dispatch(persistProjectMixer(projectId));
  }

  // Laid out top to bottom like a console channel: routing, mute/solo,
  // fader, and the name plate at the foot of the strip.
  return (
    <View style={styles.strip}>
      <View style={styles.busRow}>
        {BUS_OPTIONS.map(({ value, label }) => {
          const active = committed.bus === value;
          return (
            <Pressable
              key={value}
              onPress={() => setBus(value)}
              style={[
                styles.busPill,
                active && { backgroundColor: accentColor },
              ]}
            >
              <Text
                style={[styles.busPillText, active && styles.busPillTextActive]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.toggles}>
        <Pressable
          onPress={toggleMute}
          testID={`mute-button-${track.id}`}
          style={[styles.pill, committed.muted && styles.pillMuteActive]}
        >
          <Text
            style={[styles.pillText, committed.muted && styles.pillTextMute]}
          >
            M
          </Text>
        </Pressable>
        <Pressable
          onPress={toggleSolo}
          testID={`solo-button-${track.id}`}
          style={[styles.pill, committed.soloed && styles.pillSoloActive]}
        >
          <Text
            style={[styles.pillText, committed.soloed && styles.pillTextSolo]}
          >
            S
          </Text>
        </Pressable>
      </View>

      <View style={styles.spacer} />

      <VerticalFader
        value={committed.volume}
        onLiveChange={handleLiveVolume}
        onCommit={handleCommitVolume}
        accentColor={accentColor}
      />

      <View style={[styles.namePlate, { backgroundColor: accentColor }]}>
        <Text style={styles.name} numberOfLines={2}>
          {track.name}
        </Text>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    strip: {
      width: 104,
      marginVertical: 8,
      marginHorizontal: 2,
      paddingTop: 8,
      paddingHorizontal: 8,
      borderRadius: radii.md,
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.panelRaised,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    namePlate: {
      alignSelf: "stretch",
      marginHorizontal: -8,
      minHeight: 40,
      paddingHorizontal: 6,
      paddingVertical: 4,
      justifyContent: "center",
    },
    name: {
      color: ON_TRACK_COLOR_TEXT,
      fontSize: 12,
      fontWeight: "800",
      textAlign: "center",
    },
    spacer: {
      flex: 1,
    },
    busRow: {
      alignSelf: "stretch",
      flexDirection: "row",
      gap: 2,
      backgroundColor: lcd.background,
      borderRadius: radii.sm,
      padding: 2,
    },
    busPill: {
      flex: 1,
      // Tall enough to hit reliably on stage, even though it reads small.
      minHeight: 30,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 2,
      backgroundColor: "transparent",
    },
    busPillText: {
      color: lcd.textDim,
      fontSize: 11,
      fontWeight: "700",
    },
    busPillTextActive: {
      color: ON_TRACK_COLOR_TEXT,
    },
    toggles: {
      alignSelf: "stretch",
      flexDirection: "row",
      gap: 6,
    },
    pill: {
      flex: 1,
      height: 40,
      borderRadius: radii.sm,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderTopColor: colors.bevelLight,
      borderBottomColor: colors.bevelDark,
    },
    pillMuteActive: {
      backgroundColor: colors.danger,
      borderColor: colors.danger,
    },
    pillSoloActive: {
      backgroundColor: colors.warning,
      borderColor: colors.warning,
    },
    pillText: {
      color: colors.textSecondary,
      fontWeight: "800",
      fontSize: 14,
    },
    pillTextMute: {
      color: "#ffffff",
    },
    // `warning` is a bright yellow in dark mode and a dark amber in light
    // mode; `background` inverts the same way, so it stays legible on both.
    pillTextSolo: {
      color: colors.background,
    },
  });
}
