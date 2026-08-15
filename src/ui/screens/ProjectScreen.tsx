import { getDocumentAsync, type DocumentPickerAsset } from "expo-document-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { audioEngine, type EngineTransportState } from "@/engine";
import { trackRuntimeStatesFromManifest } from "@/engine/trackRuntimeState";
import { usePlayhead } from "@/hooks/usePlayhead";
import {
  addStemsToProject,
  decodeProjectAudio,
  deleteProjectDirectory,
  getProjectSourceForEntry,
  removeStemFromProject,
  updateProjectMetadata,
} from "@/storage";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { projectRemoved, projectUpdated, projectsSelectors } from "@/store/projectsSlice";
import { persistProjectClick } from "@/store/persistProject";
import { monitorModeSet } from "@/store/settingsSlice";
import {
  tracksInitializedForProject,
  tracksRemovedForProject,
} from "@/store/tracksSlice";
import type { ProjectManifest } from "@/types/project";
import { ChannelStrip } from "@/ui/components/ChannelStrip";
import { ClickToggle } from "@/ui/components/ClickToggle";
import { MonitorSplitSwitch } from "@/ui/components/MonitorSplitSwitch";
import { ProjectForm, type ProjectFormValues } from "@/ui/components/ProjectForm";
import { TransportBar } from "@/ui/components/TransportBar";
import { colors, elevation, radii, spacing } from "@/ui/theme";

/**
 * Press feedback goes through Pressable's `style` callback, NOT a
 * function-as-child. A function child re-creates the child View/Text on every
 * press-state change, so releasing the button re-inserts a text view in the
 * same frame that `onPress` -> `router.back()` is tearing this screen down -
 * which is exactly Android's Fabric "addViewAt: ... already has a parent"
 * crash (see AGENTS.md). Styling the Pressable itself only updates props on
 * an already-mounted view and leaves the child tree structurally constant.
 */
function HeaderButton({
  label,
  onPress,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  style?: object;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.headerButton, style, pressed && styles.pressed]}
      hitSlop={8}
      testID={testID}
    >
      <Text style={styles.headerButtonText}>{label}</Text>
    </Pressable>
  );
}

/**
 * The one and only project view - play it, edit it, or fill in a brand-new
 * one, all in the same screen the way an IDE keeps viewing and editing in one
 * workspace. There is no separate "new project" screen: "+ New" creates an
 * empty project and lands here, and a project with no stems simply opens in
 * edit mode because there is nothing to play yet.
 */
export function ProjectScreen() {
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const dispatch = useAppDispatch();
  const router = useRouter();

  const entry = useAppSelector((s) =>
    projectId ? projectsSelectors.selectById(s.projects, projectId) : undefined,
  );
  const monitorMode = useAppSelector((s) => s.settings.monitorMode);
  // Per-project, and stored in its manifest - a song either runs to a click
  // or it doesn't. Monitor/split stays global: that describes how the
  // headphone splitter is wired, which is the same for every song at a gig.
  const clickEnabled = entry?.clickEnabled ?? true;

  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transportState, setTransportState] = useState<EngineTransportState>("stopped");
  // A project with no stems can't be played, so it opens straight in edit
  // mode - that is all "creating a project" means here.
  const [editing, setEditing] = useState((entry?.tracks.length ?? 0) === 0);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Bumped to force the loader effect to re-run after stems/metadata change.
  const [reloadToken, setReloadToken] = useState(0);

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

        // Derived from the manifest rather than read back out of the store:
        // the dispatch above seeds the store from this same data, so going
        // through Redux would just be a round-trip - and reading the module's
        // store singleton would ignore whichever store the screen is actually
        // rendered under.
        audioEngine.loadProject(
          decoded,
          trackRuntimeStatesFromManifest(source.manifest.tracks),
        );
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
  }, [entry?.id, dispatch, reloadToken]);

  // Silence every path that can schedule a React render *before* handing
  // control to the navigator: detach the engine listener, kill the playhead
  // rAF loop, then stop audio (which can no longer reach setState), and only
  // then navigate.
  const teardownAndNavigate = useCallback(
    (navigate: () => void) => {
      detachTransportRef.current?.();
      detachTransportRef.current = null;
      stopPlayhead();
      audioEngine.stop();
      navigate();
    },
    [stopPlayhead],
  );

  function handleBack() {
    teardownAndNavigate(() => router.back());
  }

  function handlePlayPause() {
    if (audioEngine.getTransportState() === "playing") {
      audioEngine.pause();
    } else {
      audioEngine.play();
    }
  }

  function handleMonitorModeChange(mode: typeof monitorMode) {
    audioEngine.setMonitorMode(mode);
    dispatch(monitorModeSet(mode));
  }

  function handleClickEnabledChange(enabled: boolean) {
    audioEngine.setClickEnabled(enabled);
    if (entry) dispatch(persistProjectClick(entry.id, enabled));
  }

  function handleStartEditing() {
    // Editing can delete the very files the transport is reading, so never
    // leave audio running underneath the form.
    audioEngine.stop();
    setFormError(null);
    setEditing(true);
  }

  async function pickFiles(): Promise<DocumentPickerAsset[] | null> {
    const result = await getDocumentAsync({
      type: "audio/*",
      multiple: true,
      copyToCacheDirectory: true,
    });
    return result.canceled ? null : result.assets;
  }

  async function handleAddStems() {
    setFormError(null);
    try {
      const assets = await pickFiles();
      if (!assets || !entry?.sourceDir) return;

      setBusy(true);
      const updated = await addStemsToProject(entry.sourceDir, assets, audioEngine.context);
      dispatch(projectUpdated({ id: entry.id, changes: { tracks: updated.tracks } }));
      setReloadToken((n) => n + 1);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveStem(stemId: string) {
    setFormError(null);
    if (!entry?.sourceDir) return;
    setBusy(true);
    try {
      const updated = await removeStemFromProject(entry.sourceDir, stemId);
      dispatch(projectUpdated({ id: entry.id, changes: { tracks: updated.tracks } }));
      setReloadToken((n) => n + 1);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(values: ProjectFormValues) {
    if (!entry?.sourceDir) return;
    setBusy(true);
    setFormError(null);
    try {
      await updateProjectMetadata(entry.sourceDir, values);
      dispatch(projectUpdated({ id: entry.id, changes: values }));
      setEditing(false);
      // bpm may have changed, which adds or removes the click entirely.
      setReloadToken((n) => n + 1);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Leaving a project that still has no stems discards it. "+ New" creates
   * the project up front, so without this every abandoned "+ New" would leave
   * an empty project behind - and there is no delete-project UI to clean up
   * with. A project with stems is never touched.
   */
  function discardIfEmptyDraft() {
    if (!entry || entry.origin !== "filesystem" || entry.tracks.length > 0) return;
    try {
      if (entry.sourceDir) deleteProjectDirectory(entry.sourceDir);
      dispatch(projectRemoved(entry.id));
    } catch {
      // Losing an empty folder is not worth blocking navigation over.
    }
  }

  function handleBackFromProject() {
    discardIfEmptyDraft();
    handleBack();
  }

  /**
   * Deleting takes the project folder and its audio with it, so it asks
   * first. The engine is torn down before the files disappear underneath it.
   */
  function handleDelete() {
    if (!entry?.sourceDir) return;
    Alert.alert(
      "Delete project?",
      `"${entry.title}" and its ${entry.tracks.length} stem${entry.tracks.length === 1 ? "" : "s"} will be permanently deleted from this device.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            try {
              deleteProjectDirectory(entry.sourceDir!);
            } catch (e) {
              setFormError(e instanceof Error ? e.message : String(e));
              return;
            }
            dispatch(projectRemoved(entry.id));
            dispatch(tracksRemovedForProject(entry.id));
            teardownAndNavigate(() => router.back());
          },
        },
      ],
    );
  }

  function handleCancelEditing() {
    // With no stems there is no mixer to fall back to, so cancelling is the
    // same as abandoning the draft.
    if ((entry?.tracks.length ?? 0) === 0) {
      handleBackFromProject();
      return;
    }
    setFormError(null);
    setEditing(false);
  }

  const canEdit = entry?.origin === "filesystem";
  const formStems = (entry?.tracks ?? []).map((t) => ({ id: t.id, name: t.name }));
  const headerTitle = manifest?.title ?? entry?.title ?? "";

  function renderHeader() {
    return (
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <HeaderButton label="‹ Library" onPress={handleBackFromProject} testID="back-button" />
          {canEdit && !editing && (
            <HeaderButton label="Edit" onPress={handleStartEditing} testID="edit-button" />
          )}
        </View>
        <Text style={styles.title}>{headerTitle}</Text>
        {manifest && !editing && (
          <View style={styles.subtitleRow}>
            {manifest.bpm !== undefined && (
              <View style={styles.subtitlePill}>
                <Text style={styles.subtitlePillText}>{manifest.bpm} BPM</Text>
              </View>
            )}
            <View style={styles.subtitlePill}>
              <Text style={styles.subtitlePillText}>{manifest.key || "—"}</Text>
            </View>
          </View>
        )}
      </View>
    );
  }

  if (editing) {
    // Bundled projects live in the app bundle with no writable manifest.
    if (entry?.origin === "bundled") {
      return (
        <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
          {renderHeader()}
          <Text style={styles.notice}>The bundled demo project can&apos;t be edited.</Text>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        {renderHeader()}
        <ProjectForm
          initial={{
            title: entry?.title ?? "",
            bpm: entry?.bpm,
            key: entry?.key ?? "",
          }}
          stems={formStems}
          busy={busy}
          error={formError}
          onAddStems={handleAddStems}
          onRemoveStem={handleRemoveStem}
          onSubmit={handleSubmit}
          onCancel={handleCancelEditing}
          onDelete={entry?.sourceDir ? handleDelete : undefined}
        />
      </SafeAreaView>
    );
  }

  if (!entry) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        {renderHeader()}
        <Text style={styles.error}>Project not found.</Text>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        {renderHeader()}
        <View style={styles.centeredBody}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !manifest) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        {renderHeader()}
        <Text style={styles.error}>{error ?? "Failed to load project."}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {renderHeader()}

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
          <MonitorSplitSwitch mode={monitorMode} onChange={handleMonitorModeChange} />
          {/* No bpm means no synthesized click, so there is nothing to toggle. */}
          {manifest.bpm !== undefined && (
            <>
              <View style={styles.rackDivider} />
              <ClickToggle enabled={clickEnabled} onChange={handleClickEnabledChange} />
            </>
          )}
        </View>
        <TransportBar
          isPlaying={transportState === "playing"}
          playheadSec={playheadSec}
          durationSec={durationSec}
          onPlayPause={handlePlayPause}
          onStop={() => audioEngine.stop()}
          onSeek={(seconds) => audioEngine.seek(seconds)}
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
  centeredBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.panel,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  headerButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  headerButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.7,
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
  notice: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    marginTop: 40,
    paddingHorizontal: 24,
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
    textAlign: "center",
    marginTop: 40,
  },
});
