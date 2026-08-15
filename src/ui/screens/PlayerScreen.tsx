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
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Press feedback goes through Pressable's `style` callback, NOT a
 * function-as-child. A function child re-creates the child View/Text on every
 * press-state change, so releasing the button re-inserts a text view in the
 * same frame that `onPress` -> `router.back()` is tearing this screen down -
 * which is exactly Android's Fabric "addViewAt: ... already has a parent"
 * crash (see AGENTS.md). Styling the Pressable itself only updates props on
 * an already-mounted view and leaves the child tree structurally constant.
 */
function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.backButton,
        styles.backButtonGlass,
        pressed && styles.pressed,
      ]}
      hitSlop={8}
      testID="back-button"
    >
      <Text style={styles.backButtonText}>‹ Library</Text>
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

  const router = useRouter();
  const { seconds: playheadSec, stop: stopPlayhead } = usePlayhead();
  const detachTransportRef = useRef<(() => void) | null>(null);

  // Declared *before* the loader effect on purpose. React runs cleanups in
  // declaration order, so on unmount this one detaches the engine from React
  // state before the loader's cleanup calls audioEngine.stop(). Otherwise
  // that stop() would push a transport change into setState while the
  // navigator is tearing this screen's native views down - the "already has
  // a parent" Fabric crash in AGENTS.md. This ordering is what covers the
  // Android hardware back button and the back gesture, neither of which goes
  // through handleBack below.
  useEffect(() => {
    detachTransportRef.current = audioEngine.onTransportStateChange(setTransportState);
    return () => {
      detachTransportRef.current?.();
      detachTransportRef.current = null;
    };
  }, []);

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

  // Silence every path that can schedule a React render *before* handing
  // control to the navigator: detach the engine listener, kill the playhead
  // rAF loop, then stop audio (which can no longer reach setState), and only
  // then navigate. Leaving any of these live means a render can commit into
  // the frame where Fabric is removing this screen's views.
  function handleBack() {
    detachTransportRef.current?.();
    detachTransportRef.current = null;
    stopPlayhead();
    audioEngine.stop();
    router.back();
  }

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
        <BackButton onPress={handleBack} />
        <Text style={styles.error}>Project not found.</Text>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <BackButton onPress={handleBack} />
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (error || !manifest) {
    return (
      <SafeAreaView style={styles.centered}>
        <BackButton onPress={handleBack} />
        <Text style={styles.error}>{error ?? "Failed to load project."}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <BackButton onPress={handleBack} />
        <Text style={styles.title}>{manifest.title}</Text>
        <View style={styles.subtitleRow}>
          <View style={styles.subtitlePill}>
            <Text style={styles.subtitlePillText}>{manifest.bpm} BPM</Text>
          </View>
          <View style={styles.subtitlePill}>
            <Text style={styles.subtitlePillText}>{manifest.key || "—"}</Text>
          </View>
        </View>
      </View>

      <View style={styles.mixer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.mixerContent}
        >
          {manifest.tracks.map((item, index) => (
            <ChannelStrip key={item.id} projectId={manifest.id} track={item} index={index} />
          ))}
        </ScrollView>
      </View>

      <View style={styles.console}>
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
      </View>
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
