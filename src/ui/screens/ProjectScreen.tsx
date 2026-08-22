import { getDocumentAsync, type DocumentPickerAsset } from "expo-document-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { audioEngine } from "@/engine";
import { useTranslation } from "@/i18n";
import type { ProgressUpdate } from "@/storage/progress";
import { useNowPlaying } from "@/hooks/useNowPlaying";
import { usePlayhead } from "@/hooks/usePlayhead";
import { useTransportState } from "@/hooks/useTransportState";
import { nowPlayingStore } from "@/playback/nowPlayingStore";
import {
  addStemsToProject,
  deleteProjectDirectory,
  removeStemFromProject,
  renameStemInProject,
  updateProjectMetadata,
} from "@/storage";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { projectRemoved, projectUpdated, projectsSelectors } from "@/store/projectsSlice";
import { persistProjectClick } from "@/store/persistProject";
import { removeSongFromAllFolders } from "@/store/persistFolders";
import { monitorModeSet } from "@/store/settingsSlice";
import {
  tracksInitializedForProject,
  tracksRemovedForProject,
} from "@/store/tracksSlice";
import { HamburgerIcon } from "@/ui/components/HamburgerIcon";
import { MixerDrawer } from "@/ui/components/MixerDrawer";
import { ProjectForm, type ProjectFormValues } from "@/ui/components/ProjectForm";
import { WaveformView } from "@/ui/components/WaveformView";
import { BackButton } from "@/ui/components/BackButton";
import { HeaderButton } from "@/ui/components/HeaderButton";
import { colors, radii, spacing } from "@/ui/theme";

/**
 * The one and only project view - play it, edit it, or fill in a brand-new
 * one, all in the same screen the way an IDE keeps viewing and editing in one
 * workspace. There is no separate "new project" screen: "+ New" creates an
 * empty project and lands here, and a project with no stems simply opens in
 * edit mode because there is nothing to play yet.
 *
 * Playback itself is NOT tied to this screen's lifecycle - see
 * `nowPlayingStore`/`NowPlayingBar`. Loading a project into the engine, the
 * live transport, and the persistent bottom bar all survive navigating away
 * (Back, editing, browsing the Library); this screen only loads a project in
 * (deferring to the shared store if it's already the current one) and
 * renders whatever the shared store says is current, once it agrees with
 * the project this screen represents.
 */
export function ProjectScreen() {
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { t } = useTranslation();

  const entry = useAppSelector((s) =>
    projectId ? projectsSelectors.selectById(s.projects, projectId) : undefined,
  );
  const monitorMode = useAppSelector((s) => s.settings.monitorMode);
  // Per-project, and stored in its manifest - a song either runs to a click
  // or it doesn't. Monitor/split stays global: that describes how the
  // headphone splitter is wired, which is the same for every song at a gig.
  const clickEnabled = entry?.clickEnabled ?? true;

  const nowPlaying = useNowPlaying();
  const isCurrent = entry !== undefined && nowPlaying.projectId === entry.id;

  // This screen's own "did *my* load attempt succeed" state - distinct from
  // the shared store's state, which might still (correctly) reflect a
  // *different* project if this one's load failed. See nowPlayingStore's
  // decode-failure handling.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mixerOpen, setMixerOpen] = useState(false);
  // A project with no stems can't be played, so it opens straight in edit
  // mode - that is all "creating a project" means here.
  const [editing, setEditing] = useState((entry?.tracks.length ?? 0) === 0);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // What the current slow operation is doing, so a multi-second import or
  // decode says so instead of showing an empty screen.
  const [status, setStatus] = useState<string | null>(null);

  const { seconds: playheadSec, stop: stopPlayhead } = usePlayhead();

  /**
   * Anything that edits a project ends in nowPlayingStore.reload(), and
   * AudioEngine.loadProject() opens with stop() + disposeTracks() - so an
   * import or a save mid-song would cut the song off and tear the graph
   * down. Nothing that can do that is reachable while the transport is
   * running. Guarded at the handlers, not just the buttons, so a stale tap
   * or a race can't get past it.
   *
   * Deliberately keyed on the transport being *playing at all*, not on this
   * project being the one playing: reload() loads this project into the one
   * shared engine, so editing project A would stop project B just the same.
   */
  const transportState = useTransportState();
  const isPlaying = transportState === "playing";

  /**
   * The handlers ask the engine directly rather than reading `isPlaying`
   * above. React state trails the engine by a render - a tap landing in that
   * window would otherwise sail straight through the guard and rebuild the
   * graph mid-song. `isPlaying` drives the UI; this decides.
   */
  function transportIsRunning() {
    return audioEngine.getTransportState() === "playing";
  }

  const describeProgress = useCallback(
    (update: ProgressUpdate): string => {
      switch (update.phase) {
        case 'copying':
          return update.total && update.total > 1 && update.current
            ? t.progress.copyingOf(update.name ?? '', update.current, update.total)
            : t.progress.copying(update.name ?? '');
        case 'converting':
          return update.name
            ? t.progress.converting(update.name)
            : t.progress.convertingGeneric;
        case 'decoding':
          return update.total && update.total > 1 && update.current
            ? t.progress.decodingOf(update.current, update.total)
            : t.progress.decoding;
        case 'building':
          return t.progress.building;
        case 'waveforms':
          return t.progress.waveforms;
      }
    },
    [t]
  );

  /**
   * Every slow path here (open/reload/import) keeps running after the user
   * navigates away - that's deliberate, nowPlayingStore owns it, not this
   * screen. So their callbacks and their `finally` blocks can land on a
   * screen that is already unmounting, and a setState committing while the
   * navigator tears this screen's native views down is exactly the class of
   * Fabric crash AGENTS.md documents. Redux dispatches are left alone: the
   * store outlives the screen and those writes are the point of the work.
   *
   * Re-armed on mount rather than only initialised, so a remounted screen
   * (StrictMode's double-invoke, a fast route re-entry) isn't left inert.
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onProgress = useCallback(
    (update: ProgressUpdate) => {
      if (!mountedRef.current) return;
      setStatus(describeProgress(update));
    },
    [describeProgress]
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!entry) return;
      if (entry.tracks.length === 0) {
        // Nothing to decode - matches the `editing` default above.
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const { manifest } = await nowPlayingStore.openProject(
          entry,
          { monitorMode, clickEnabled },
          onProgress,
        );
        if (cancelled) return;
        dispatch(
          tracksInitializedForProject({ projectId: entry.id, tracks: manifest.tracks }),
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setStatus(null);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- monitorMode/clickEnabled intentionally only applied on (re)load
  }, [entry?.id, dispatch]);

  /** Forces a fresh reload of the current project (its content actually changed) and re-seeds the store's mixer state from the result. */
  const reloadAndSeed = useCallback(async () => {
    if (!entry) return;
    const { manifest } = await nowPlayingStore.reload(
      entry,
      { monitorMode, clickEnabled },
      onProgress,
    );
    dispatch(tracksInitializedForProject({ projectId: entry.id, tracks: manifest.tracks }));
  }, [entry, monitorMode, clickEnabled, dispatch, onProgress]);

  // Kills this screen's own rAF-driven waveform re-render loop before
  // navigating away - independent of whether the engine itself keeps
  // playing (it does; see nowPlayingStore). Left in place because a stray
  // setState from this loop committing while the navigator tears this
  // screen's native views down is exactly the class of Fabric crash
  // AGENTS.md documents, regardless of what audio is doing underneath.
  const teardownAndNavigate = useCallback(
    (navigate: () => void) => {
      stopPlayhead();
      navigate();
    },
    [stopPlayhead],
  );

  function handleBack() {
    teardownAndNavigate(() => router.back());
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
    if (transportIsRunning()) return;
    setFormError(null);
    setEditing(true);
    // Otherwise cancelling out of the form would land back on the mixer
    // with the drawer still open, right where the user tapped Edit from.
    setMixerOpen(false);
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
    if (transportIsRunning()) {
      setFormError(t.project.lockedWhilePlayingBody);
      return;
    }
    setFormError(null);
    try {
      const assets = await pickFiles();
      if (!assets || !entry?.sourceDir) return;

      setBusy(true);
      const updated = await addStemsToProject(
        entry.sourceDir,
        assets,
        audioEngine.context,
        onProgress,
      );
      dispatch(projectUpdated({ id: entry.id, changes: { tracks: updated.tracks } }));
      await reloadAndSeed();
    } catch (e) {
      if (mountedRef.current) setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) {
        setBusy(false);
        setStatus(null);
      }
    }
  }

  async function handleRemoveStem(stemId: string) {
    if (transportIsRunning()) {
      setFormError(t.project.lockedWhilePlayingBody);
      return;
    }
    setFormError(null);
    if (!entry?.sourceDir) return;
    setBusy(true);
    try {
      const updated = await removeStemFromProject(entry.sourceDir, stemId);
      dispatch(projectUpdated({ id: entry.id, changes: { tracks: updated.tracks } }));
      await reloadAndSeed();
    } catch (e) {
      if (mountedRef.current) setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  /**
   * Unlike add/remove, a rename touches only a display name - it doesn't
   * change what's decoded or how the engine's graph is wired, so there's no
   * need to pay for a full re-decode. Patches the shared store's already-
   * loaded manifest/waveform directly instead.
   *
   * Returns whether the write actually persisted - StemNameField shows the
   * new name optimistically and needs to revert it if this resolves false,
   * rather than drifting out of sync with what's actually on disk.
   */
  // Not blocked while playing, unlike the others: renaming only rewrites a
  // label in the manifest and patches the snapshot in place - it never calls
  // reload(), so the engine graph and the running transport are untouched.
  async function handleRenameStem(stemId: string, name: string): Promise<boolean> {
    setFormError(null);
    if (!entry?.sourceDir) return false;
    try {
      const updated = await renameStemInProject(entry.sourceDir, stemId, name);
      dispatch(projectUpdated({ id: entry.id, changes: { tracks: updated.tracks } }));
      nowPlayingStore.renameTrackLocal(stemId, name);
      return true;
    } catch (e) {
      if (mountedRef.current) setFormError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function handleSubmit(values: ProjectFormValues) {
    if (transportIsRunning()) {
      setFormError(t.project.lockedWhilePlayingBody);
      return;
    }
    if (!entry?.sourceDir) return;
    setBusy(true);
    setFormError(null);
    try {
      await updateProjectMetadata(entry.sourceDir, values);
      dispatch(projectUpdated({ id: entry.id, changes: values }));
      setEditing(false);
      // bpm may have changed, which adds or removes the click entirely.
      await reloadAndSeed();
    } catch (e) {
      if (mountedRef.current) setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setBusy(false);
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
   * first. If this is the project currently loaded/playing, that's stopped
   * and cleared before the files disappear underneath it.
   */
  // Not blocked while playing, unlike the rebuilding paths: deleting
  // deliberately *stops* the engine and clears the project rather than
  // reloading underneath a running transport, so it's safe - and being
  // unable to delete a project without first stopping it would be a strange
  // restriction.
  function handleDelete() {
    if (!entry?.sourceDir) return;
    Alert.alert(
      t.project.deleteConfirmTitle,
      t.project.deleteConfirmBody(entry.title, entry.tracks.length),
      [
        { text: t.common.cancel, style: "cancel" },
        {
          text: t.project.deleteConfirmConfirm,
          style: "destructive",
          onPress: () => {
            try {
              deleteProjectDirectory(entry.sourceDir!);
            } catch (e) {
              setFormError(e instanceof Error ? e.message : String(e));
              return;
            }
            nowPlayingStore.closeIfCurrent(entry.id);
            dispatch(projectRemoved(entry.id));
            dispatch(tracksRemovedForProject(entry.id));
            // Folders hold song ids, so any that listed this project would be
            // left pointing at nothing. The Library hides unresolvable ids
            // anyway; this keeps the files on disk honest.
            dispatch(removeSongFromAllFolders(entry.id));
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
  const headerTitle = (isCurrent ? nowPlaying.manifest?.title : undefined) ?? entry?.title ?? "";

  function renderHeader() {
    return (
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <BackButton label={t.project.backToLibrary} onPress={handleBackFromProject} testID="back-button" />
          {isCurrent && nowPlaying.manifest && !editing && (
            <Pressable
              onPress={() => setMixerOpen(true)}
              style={({ pressed }) => [styles.mixerButton, pressed && styles.mixerButtonPressed]}
              hitSlop={8}
              testID="mixer-menu-button"
              accessibilityLabel={t.project.mixer}
            >
              <HamburgerIcon />
            </Pressable>
          )}
        </View>
        <Text style={styles.title}>{headerTitle}</Text>
        {isCurrent && nowPlaying.manifest && !editing && (
          <View style={styles.subtitleRow}>
            {nowPlaying.manifest.bpm !== undefined && (
              <View style={styles.subtitlePill}>
                <Text style={styles.subtitlePillText}>{nowPlaying.manifest.bpm} BPM</Text>
              </View>
            )}
            <View style={styles.subtitlePill}>
              <Text style={styles.subtitlePillText}>{nowPlaying.manifest.key || "—"}</Text>
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
          <Text style={styles.notice}>{t.project.bundledNotice}</Text>
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
          status={status}
          error={formError}
          onAddStems={handleAddStems}
          onRemoveStem={handleRemoveStem}
          onRenameStem={handleRenameStem}
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
        <Text style={styles.error}>{t.project.notFound}</Text>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        {renderHeader()}
        <View style={styles.centeredBody}>
          <ActivityIndicator color={colors.accent} />
          {status ? (
            <Text style={styles.loadingStatus} testID="loading-status">
              {status}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  if (error || !isCurrent || !nowPlaying.manifest) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        {renderHeader()}
        <Text style={styles.error}>{error ?? t.project.loadFailed}</Text>
        {/* A failed load (e.g. a corrupted stem) is exactly when editing - to remove or
            replace the offending stem - matters most, so this can't live only behind the
            mixer drawer like the rest of Edit's access: there's no mixer to open here. */}
        {canEdit && (
          <View style={styles.errorActions}>
            <HeaderButton label={t.project.edit} onPress={handleStartEditing} testID="edit-button" />
          </View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {renderHeader()}

      <View style={styles.waveformArea}>
        <WaveformView
          tracks={nowPlaying.waveformTracks}
          durationSec={nowPlaying.durationSec}
          playheadSec={playheadSec}
        />
      </View>

      <MixerDrawer
        visible={mixerOpen}
        onClose={() => setMixerOpen(false)}
        manifest={nowPlaying.manifest}
        monitorMode={monitorMode}
        onMonitorModeChange={handleMonitorModeChange}
        clickEnabled={clickEnabled}
        onClickEnabledChange={handleClickEnabledChange}
        onEdit={canEdit ? handleStartEditing : undefined}
        editDisabledReason={isPlaying ? t.project.lockedWhilePlaying : undefined}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingStatus: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 14,
    textAlign: "center",
    paddingHorizontal: 32,
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
  waveformArea: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
  },
  mixerButton: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  mixerButtonPressed: {
    opacity: 0.7,
  },
  error: {
    color: colors.danger,
    fontSize: 15,
    textAlign: "center",
    marginTop: 40,
  },
  errorActions: {
    alignItems: "center",
    marginTop: spacing.lg,
  },
});
