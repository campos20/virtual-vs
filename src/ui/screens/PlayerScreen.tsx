import {
  audioEngine,
  type EngineTransportState,
  type TrackRuntimeState,
} from "@/engine";
import { usePlayhead } from "@/hooks/usePlayhead";
import { decodeProjectAudio, getProjectSourceForEntry } from "@/storage";
import { store } from "@/store";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { projectsSelectors } from "@/store/projectsSlice";
import { clickEnabledSet, monitorModeSet } from "@/store/settingsSlice";
import {
  trackEntityId,
  tracksInitializedForProject,
  tracksSelectors,
} from "@/store/tracksSlice";
import type { ProjectManifest } from "@/types/project";
import { ChannelStrip } from "@/ui/components/ChannelStrip";
import { ClickToggle } from "@/ui/components/ClickToggle";
import { MonitorSplitSwitch } from "@/ui/components/MonitorSplitSwitch";
import { TransportBar } from "@/ui/components/TransportBar";
import { colors, elevation, radii, spacing } from "@/ui/theme";
import { GlassView } from "expo-glass-effect";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

function BackButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.back()}
      style={styles.backButton}
      hitSlop={8}
      testID="back-button"
    >
      {({ pressed }) => (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          style={[styles.backButtonGlass, pressed && styles.pressed]}
        >
          <Text style={styles.backButtonText}>‹ Library</Text>
        </GlassView>
      )}
    </Pressable>
  );
}

export function PlayerScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const dispatch = useAppDispatch();
  const entry = useAppSelector((s) =>
    projectId ? projectsSelectors.selectById(s.projects, projectId) : undefined,
  );
  const monitorMode = useAppSelector((s) => s.settings.monitorMode);
  const clickEnabled = useAppSelector((s) => s.settings.clickEnabled);

  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transportState, setTransportState] =
    useState<EngineTransportState>("stopped");

  const { seconds: playheadSec } = usePlayhead();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!entry) return;
      setLoading(true);
      setError(null);
      try {
        const source = await getProjectSourceForEntry(entry);
        const decoded = await decodeProjectAudio(audioEngine.context, source);
        if (cancelled) return;

        dispatch(
          tracksInitializedForProject({
            projectId: entry.id,
            tracks: source.manifest.tracks,
          }),
        );

        const tracksState = store.getState().tracks;
        const initialTrackStates: Record<string, TrackRuntimeState> = {};
        for (const track of source.manifest.tracks) {
          const committed = tracksSelectors.selectById(
            tracksState,
            trackEntityId(entry.id, track.id),
          );
          if (committed) {
            initialTrackStates[track.id] = {
              id: track.id,
              bus: committed.bus,
              volume: committed.volume,
              muted: committed.muted,
              soloed: committed.soloed,
            };
          }
        }

        audioEngine.loadProject(decoded, initialTrackStates);
        audioEngine.setMonitorMode(monitorMode);
        audioEngine.setClickEnabled(clickEnabled);

        const longestBufferSec = source.manifest.tracks.reduce(
          (max, t) => Math.max(max, decoded.trackBuffers[t.id]?.duration ?? 0),
          0,
        );

        setDurationSec(longestBufferSec);
        setManifest(source.manifest);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      audioEngine.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- monitorMode/clickEnabled intentionally only applied on (re)load
  }, [entry?.id, dispatch]);

  // The engine drives natural end-of-playback itself (see AudioEngine.handlePlaybackEndedNaturally)
  // and notifies us here, rather than this component polling playheadSec against durationSec.
  useEffect(() => {
    return audioEngine.onTransportStateChange(setTransportState);
  }, []);

  function handlePlayPause() {
    if (audioEngine.getTransportState() === "playing") {
      audioEngine.pause();
    } else {
      audioEngine.play();
    }
  }

  function handleStop() {
    audioEngine.stop();
  }

  function handleSeek(seconds: number) {
    audioEngine.seek(seconds);
  }

  function handleMonitorModeChange(mode: typeof monitorMode) {
    audioEngine.setMonitorMode(mode);
    dispatch(monitorModeSet(mode));
  }

  function handleClickEnabledChange(enabled: boolean) {
    audioEngine.setClickEnabled(enabled);
    dispatch(clickEnabledSet(enabled));
  }

  if (!entry) {
    return (
      <SafeAreaView style={styles.centered}>
        <BackButton />
        <Text style={styles.error}>Project not found.</Text>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <BackButton />
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (error || !manifest) {
    return (
      <SafeAreaView style={styles.centered}>
        <BackButton />
        <Text style={styles.error}>{error ?? "Failed to load project."}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <GlassView glassEffectStyle="regular" style={styles.header}>
        <BackButton />
        <Text style={styles.title}>{manifest.title}</Text>
        <View style={styles.subtitleRow}>
          <View style={styles.subtitlePill}>
            <Text style={styles.subtitlePillText}>{manifest.bpm} BPM</Text>
          </View>
          <View style={styles.subtitlePill}>
            <Text style={styles.subtitlePillText}>{manifest.key || "—"}</Text>
          </View>
        </View>
      </GlassView>

      <View style={styles.mixer}>
        <FlatList
          horizontal
          data={manifest.tracks}
          keyExtractor={(t) => t.id}
          renderItem={({ item, index }) => (
            <ChannelStrip projectId={manifest.id} track={item} index={index} />
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.mixerContent}
        />
      </View>

      <GlassView glassEffectStyle="regular" style={styles.console}>
        <View style={styles.rack}>
          <MonitorSplitSwitch
            mode={monitorMode}
            onChange={handleMonitorModeChange}
          />
          <View style={styles.rackDivider} />
          <ClickToggle enabled={clickEnabled} onChange={handleClickEnabledChange} />
        </View>
        <TransportBar
          isPlaying={transportState === "playing"}
          playheadSec={playheadSec}
          durationSec={durationSec}
          onPlayPause={handlePlayPause}
          onStop={handleStop}
          onSeek={handleSeek}
        />
      </GlassView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: 48,
    paddingBottom: spacing.md,
    backgroundColor: colors.panel,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backButton: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.lg,
    zIndex: 1,
  },
  backButtonGlass: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  pressed: {
    opacity: 0.7,
  },
  backButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "700",
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  subtitleRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
  },
  subtitlePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  subtitlePillText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  mixer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  mixerContent: {
    // Strips stretch to fill the mixer area so the console reads as one
    // continuous surface instead of floating above empty space.
    alignItems: "stretch",
    paddingHorizontal: 6,
  },
  console: {
    backgroundColor: colors.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    ...elevation,
  },
  rack: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  rackDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  error: {
    color: colors.danger,
    fontSize: 15,
  },
});
