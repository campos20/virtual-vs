import { audioEngine } from "@/engine";
import { useNowPlaying } from "@/hooks/useNowPlaying";
import { usePlayhead } from "@/hooks/usePlayhead";
import { useTransportState } from "@/hooks/useTransportState";
import { useTranslation } from "@/i18n";
import { nowPlayingStore } from "@/playback/nowPlayingStore";
import { useSongScreenShortcuts } from "@/platform/desktop";
import {
  addStemsToProject,
  deleteProjectDirectory,
  moveStemInProject,
  removeStemFromProject,
  renameStemInProject,
  shareBundle,
  updateProjectMetadata,
  writeBundleToCache,
} from "@/storage";
import type { ProgressUpdate } from "@/storage/progress";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { removeSongFromAllFolders } from "@/store/persistFolders";
import {
  persistProjectClick,
  persistProjectLyrics,
  persistProjectLyricsSync,
  persistProjectSections,
} from "@/store/persistProject";
import {
  persistLyricsAllCaps,
  persistLyricsFontSize,
  persistLyricsViewActive,
} from "@/store/persistSettings";
import {
  projectRemoved,
  projectUpdated,
  projectsSelectors,
} from "@/store/projectsSlice";
import { setlistsSelectors } from "@/store/setlistsSlice";
import { monitorModeSet } from "@/store/settingsSlice";
import {
  tracksInitializedForProject,
  tracksRemovedForProject,
} from "@/store/tracksSlice";
import type { LyricsSyncPoint, SectionManifest } from "@/types/project";
import { BackButton } from "@/ui/components/BackButton";
import { Chevron } from "@/ui/components/Chevron";
import { HeaderButton } from "@/ui/components/HeaderButton";
import { LyricsDrawer } from "@/ui/components/LyricsDrawer";
import { LyricsSyncDrawer } from "@/ui/components/LyricsSyncDrawer";
import { LyricsView } from "@/ui/components/LyricsView";
import { MarkersDrawer } from "@/ui/components/MarkersDrawer";
import { MixerDrawer } from "@/ui/components/MixerDrawer";
import {
  ProjectForm,
  type ProjectFormValues,
} from "@/ui/components/ProjectForm";
import { SongListDrawer } from "@/ui/components/SongListDrawer";
import { WaveformView } from "@/ui/components/WaveformView";
import { neighbouringSongs, resolveSongSequence } from "@/ui/libraryTree";
import { moveId } from "@/ui/reorder";
import { radii, spacing, useThemeColors, type ThemeColors } from "@/ui/theme";
import {
  getDocumentAsync,
  type DocumentPickerAsset,
} from "expo-document-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/** Short random id for a newly added marker - only needs to be unique within one project's list. */
function generateMarkerId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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
  const { projectId, folderId, autoPlay } = useLocalSearchParams<{
    projectId?: string;
    folderId?: string;
    /** Set only by the song list drawer's "Play next" button - see `handleSwitchToSong`. */
    autoPlay?: string;
  }>();
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { t } = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const entry = useAppSelector((s) =>
    projectId ? projectsSelectors.selectById(s.projects, projectId) : undefined,
  );
  // Only set when this screen was opened from inside a folder (see
  // LibraryScreen's `openProject`) - then previous/next and the Songs list
  // follow that folder; otherwise they follow the Library's top-level songs.
  // `folder` is looked up fresh each render rather than trusted from
  // whatever the Library passed, so a rename is reflected and a deletion
  // (of the folder, or of this song from it) since this screen opened falls
  // back to the Library list instead of showing something stale.
  const folder = useAppSelector((s) =>
    folderId ? setlistsSelectors.selectById(s.setlists, folderId) : undefined,
  );
  const allProjects = useAppSelector((s) =>
    projectsSelectors.selectAll(s.projects),
  );
  const allFolders = useAppSelector((s) =>
    setlistsSelectors.selectAll(s.setlists),
  );
  const libraryOrder = useAppSelector((s) => s.settings.libraryOrder);
  const songSequence = useMemo(
    () => resolveSongSequence(folder, allProjects, allFolders, libraryOrder),
    [folder, allProjects, allFolders, libraryOrder],
  );
  // Never wraps: null at either end of the list.
  const {
    index: sequenceIndex,
    previousId: previousSongId,
    nextId: nextSongId,
  } = neighbouringSongs(songSequence, entry?.id);
  const monitorMode = useAppSelector((s) => s.settings.monitorMode);
  const lyricsFontSizePt = useAppSelector((s) => s.settings.lyricsFontSizePt);
  const lyricsAllCaps = useAppSelector((s) => s.settings.lyricsAllCaps);
  // Global, not local component state: switching songs (or restarting the
  // app) should keep showing lyrics if that's the view the performer left
  // it on, rather than resetting to the waveform on every project mount.
  const showLyrics = useAppSelector((s) => s.settings.lyricsViewActive);
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
  const [markersOpen, setMarkersOpen] = useState(false);
  const [songListOpen, setSongListOpen] = useState(false);
  const [lyricsEditorOpen, setLyricsEditorOpen] = useState(false);
  const [lyricsSyncOpen, setLyricsSyncOpen] = useState(false);
  // A project with no stems can't be played, so it opens straight in edit
  // mode - that is all "creating a project" means here.
  const [editing, setEditing] = useState((entry?.tracks.length ?? 0) === 0);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // What the current slow operation is doing, so a multi-second import or
  // decode says so instead of showing an empty screen.
  const [status, setStatus] = useState<string | null>(null);

  const {
    seconds: playheadSec,
    ref: playheadRef,
    stop: stopPlayhead,
  } = usePlayhead();

  /**
   * Anything that edits a project ends in a nowPlayingStore reload, and
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
        case "copying":
          return update.total && update.total > 1 && update.current
            ? t.progress.copyingOf(
                update.name ?? "",
                update.current,
                update.total,
              )
            : t.progress.copying(update.name ?? "");
        case "converting":
          return update.name
            ? t.progress.converting(update.name)
            : t.progress.convertingGeneric;
        case "decoding":
          return update.total && update.total > 1 && update.current
            ? t.progress.decodingOf(update.current, update.total)
            : t.progress.decoding;
        case "building":
          return t.progress.building;
        case "waveforms":
          return t.progress.waveforms;
        case "exporting":
          return t.progress.exporting(
            update.name ?? "",
            update.current ?? 0,
            update.total ?? 0,
          );
        case "importing":
          return t.progress.importing(
            update.name ?? "",
            update.current ?? 0,
            update.total ?? 0,
          );
      }
    },
    [t],
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
    [describeProgress],
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
          tracksInitializedForProject({
            projectId: entry.id,
            tracks: manifest.tracks,
          }),
        );
        // Set only by the song list drawer's "Play next" button - jumping
        // here any other way (Library, previous/next, a plain row tap in that drawer)
        // loads the song and stops, same as always; only this one path is
        // meant to carry straight on without a separate Play tap.
        //
        // Unless the play lock is held: an add/remove/save on this song may
        // still be saving, and its reload would stop the song moments after
        // it started. Then the song is left loaded and stopped, and the
        // performer presses play once the button unlocks. It's not started
        // automatically when the lock releases - a song starting on its own at
        // some later, unpredictable moment is worse on stage than not
        // starting.
        if (autoPlay === "1" && nowPlayingStore.canStartPlayback()) {
          audioEngine.play();
        }
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

  /**
   * Remembers this project's folder on `nowPlayingStore` whenever the route
   * actually names one, so `NowPlayingBar`'s `goToSong()` can carry it
   * forward later. Deliberately one-directional (only ever writes a real
   * `folderId`, never clears it back to `null`): a route opened *without* a
   * `folderId` - e.g. the mini-player's own jump back into this same
   * project - must not erase a folder context set moments earlier. A
   * genuinely folder-less project already starts with `folderId: null` from
   * `nowPlayingStore.loadFresh()`.
   *
   * Gated on `nowPlaying.projectId` (not just `entry?.id`/`folderId`): the
   * load effect above is async, so on a fresh open this effect's first run
   * would otherwise race ahead of `nowPlayingStore.openProject()` actually
   * committing - `setFolderContext()` would no-op against the *previous*
   * project, and since none of this effect's deps change once the load
   * later resolves, it would never get a second chance to run. Re-running
   * it once `nowPlaying.projectId` itself catches up to `entry.id` closes
   * that race.
   */
  useEffect(() => {
    if (!entry || !folderId) return;
    if (nowPlaying.projectId !== entry.id) return;
    nowPlayingStore.setFolderContext(entry.id, folderId);
  }, [entry?.id, folderId, nowPlaying.projectId]);

  /**
   * Forces a fresh reload of the current project (its content actually
   * changed) and re-seeds the store's mixer state from the result.
   *
   * `generation` is `nowPlayingStore.loadGeneration()` taken when the edit
   * started. If another song has been opened since (the user navigated away
   * while the edit's disk work ran), the reload is skipped rather than
   * replacing the song they chose - see `reloadUnlessSuperseded`.
   */
  const reloadAndSeed = useCallback(
    async (generation: number) => {
      if (!entry) return;
      const result = await nowPlayingStore.reloadUnlessSuperseded(
        entry,
        { monitorMode, clickEnabled },
        generation,
        onProgress,
      );
      if (!result) return;
      const { manifest } = result;
      dispatch(
        tracksInitializedForProject({
          projectId: entry.id,
          tracks: manifest.tracks,
        }),
      );
    },
    [entry, monitorMode, clickEnabled, dispatch, onProgress],
  );

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

  /**
   * Adds a marker at the exact instant this was called, read straight off
   * `playheadRef` rather than the throttled `playheadSec` state - the same
   * "instantaneous value, not the ~15fps display one" reasoning usePlayhead
   * documents for driving anything precise off the transport.
   */
  function handleAddMarker(name: string) {
    if (!entry || !nowPlaying.manifest) return;
    const section: SectionManifest = {
      id: generateMarkerId(),
      name,
      startSec: playheadRef.current,
    };
    const sections = [...nowPlaying.manifest.sections, section].sort(
      (a, b) => a.startSec - b.startSec,
    );
    nowPlayingStore.setSectionsLocal(sections);
    dispatch(persistProjectSections(entry.id, sections));
  }

  function handleRemoveMarker(sectionId: string) {
    if (!entry || !nowPlaying.manifest) return;
    const sections = nowPlaying.manifest.sections.filter(
      (s) => s.id !== sectionId,
    );
    nowPlayingStore.setSectionsLocal(sections);
    dispatch(persistProjectSections(entry.id, sections));
  }

  function handleJumpToMarker(startSec: number) {
    audioEngine.seek(startSec);
    setMarkersOpen(false);
  }

  /**
   * Not gated on `transportIsRunning()`, unlike the ProjectForm/reload path:
   * lyrics text never touches decode or the click track, so there's no
   * reason a performer fixing a typo mid-song should be blocked - same
   * reasoning persistProjectSections/handleAddMarker already establish.
   */
  function handleSaveLyrics(lyrics: string) {
    if (!entry) return;
    nowPlayingStore.setLyricsLocal(lyrics);
    dispatch(persistProjectLyrics(entry.id, lyrics));
  }

  /** Shared commit path for every tap-to-sync change - not gated on playback, same reasoning as persistProjectSections. */
  function commitLyricsSync(updated: LyricsSyncPoint[]) {
    if (!entry) return;
    nowPlayingStore.setLyricsSyncLocal(updated);
    dispatch(persistProjectLyricsSync(entry.id, updated));
  }

  /**
   * Reads `playheadRef.current` (the precise, un-throttled value) rather
   * than the ~15fps `playheadSec` state, same reasoning handleAddMarker
   * documents for "the exact instant this happened".
   */
  function handleTapLyricsLine(lineIndex: number) {
    if (!nowPlaying.manifest) return;
    const existing = nowPlaying.manifest.lyricsSyncPoints ?? [];
    commitLyricsSync([
      ...existing.filter((p) => p.lineIndex !== lineIndex),
      { lineIndex, timeSec: playheadRef.current },
    ]);
  }

  /** Discards one line's tap-to-sync correction, opened from the Sync drawer's per-row Remove. */
  function handleRemoveLyricsSyncPoint(lineIndex: number) {
    const existing = nowPlaying.manifest?.lyricsSyncPoints ?? [];
    commitLyricsSync(existing.filter((p) => p.lineIndex !== lineIndex));
  }

  /** Discards every tap-to-sync correction, reverting to plain duration-proportional scroll. */
  function handleClearLyricsSync() {
    commitLyricsSync([]);
  }

  function handleLyricsFontSizeChange(fontSizePt: number) {
    dispatch(persistLyricsFontSize(fontSizePt));
  }

  function handleLyricsAllCapsChange(allCaps: boolean) {
    dispatch(persistLyricsAllCaps(allCaps));
  }

  function handleSetLyricsView(next: boolean) {
    if (next === showLyrics) return;
    dispatch(persistLyricsViewActive(next));
  }

  function handleStartEditing() {
    if (transportIsRunning()) return;
    setFormError(null);
    setEditing(true);
    // Edit (or a keyboard shortcut) can be hit with the mixer open, and
    // cancelling out of the form shouldn't land back on the open drawer.
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

  /**
   * Packs this one project - manifest, mix and every stem - into a `.vvs`
   * file and hands it to the OS share sheet, which is where "Save to Drive"
   * lives. Blocked mid-song for the same reason editing is: moving hundreds
   * of megabytes competes with playback for the JS thread.
   */
  async function handleExport() {
    if (transportIsRunning()) {
      setFormError(t.project.lockedWhilePlayingBody);
      return;
    }
    if (!entry) return;

    setFormError(null);
    setBusy(true);
    try {
      const bundle = await writeBundleToCache(
        { projects: [entry], folders: [] },
        entry.title,
        onProgress,
      );
      if (mountedRef.current) setStatus(null);
      await shareBundle(bundle, t.folder.export);
    } catch (e) {
      if (mountedRef.current)
        setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) {
        setBusy(false);
        setStatus(null);
      }
    }
  }

  async function handleAddStems() {
    if (transportIsRunning()) {
      setFormError(t.project.lockedWhilePlayingBody);
      return;
    }
    // Held from the check above until the reload is done - through the file
    // picker and the copy too, so the song can't be started during them and
    // then cut off by the reload. See nowPlayingStore.holdPlayback.
    const releasePlayback = nowPlayingStore.holdPlayback();
    const generation = nowPlayingStore.loadGeneration();
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
      dispatch(
        projectUpdated({ id: entry.id, changes: { tracks: updated.tracks } }),
      );
      await reloadAndSeed(generation);
    } catch (e) {
      if (mountedRef.current)
        setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      releasePlayback();
      if (mountedRef.current) {
        setBusy(false);
        setStatus(null);
      }
    }
  }

  /**
   * Removing a track deletes this app's copy of its audio file, and there is
   * no undo - so, like deleting a whole song, it asks first. The ✕ sits right
   * next to the move arrows, which makes a stray tap easy.
   */
  function handleRemoveStem(stemId: string) {
    if (transportIsRunning()) {
      setFormError(t.project.lockedWhilePlayingBody);
      return;
    }
    if (!entry?.sourceDir) return;
    const name = entry.tracks.find((track) => track.id === stemId)?.name ?? "";
    Alert.alert(
      t.projectForm.removeConfirmTitle,
      t.projectForm.removeConfirmBody(name),
      [
        { text: t.common.cancel, style: "cancel" },
        {
          text: t.projectForm.removeConfirmConfirm,
          style: "destructive",
          onPress: () => {
            void removeStem(stemId);
          },
        },
      ],
    );
  }

  async function removeStem(stemId: string) {
    // Re-checked: the transport may have started while the dialog was open.
    if (transportIsRunning()) {
      setFormError(t.project.lockedWhilePlayingBody);
      return;
    }
    setFormError(null);
    if (!entry?.sourceDir) return;
    // Held through the manifest write (which may queue behind other edits)
    // and the reload - see handleAddStems.
    const releasePlayback = nowPlayingStore.holdPlayback();
    const generation = nowPlayingStore.loadGeneration();
    setBusy(true);
    try {
      const updated = await removeStemFromProject(entry.sourceDir, stemId);
      dispatch(
        projectUpdated({ id: entry.id, changes: { tracks: updated.tracks } }),
      );
      await reloadAndSeed(generation);
    } catch (e) {
      if (mountedRef.current)
        setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      releasePlayback();
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
  async function handleRenameStem(
    stemId: string,
    name: string,
  ): Promise<boolean> {
    setFormError(null);
    if (!entry?.sourceDir) return false;
    const projectId = entry.id;
    try {
      const updated = await renameStemInProject(entry.sourceDir, stemId, name);
      dispatch(
        projectUpdated({ id: projectId, changes: { tracks: updated.tracks } }),
      );
      nowPlayingStore.renameTrackLocal(projectId, stemId, name);
      return true;
    } catch (e) {
      if (mountedRef.current)
        setFormError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /**
   * Set while a move is saving (and, if it needs one, reloading). The arrows
   * are disabled meanwhile and the handler refuses taps, so moves run
   * strictly one at a time and each one is computed from the order the last
   * one actually saved. The ref is what the handler trusts - a second tap
   * can land before the re-render that disables the arrows.
   */
  const moveInFlightRef = useRef(false);
  const [moveInFlight, setMoveInFlight] = useState(false);

  /**
   * Moves a track one place up or down. Like a rename, this is allowed while
   * playing: track order is display-only (the engine keys every stem by id
   * and starts them all from one shared time), so it patches the loaded
   * project in place and never rebuilds the audio graph.
   *
   * The one exception is a project with more stems than have waveform lanes,
   * where moving one into view needs its waveform computed - only a full
   * reload can do that, and a reload ends by replacing the engine's
   * transport. So that move:
   * - is refused while playing, before anything is saved (playback can be
   *   started from the NowPlayingBar while the editor is open);
   * - when stopped, takes the play lock (`nowPlayingStore.holdPlayback`) in
   *   the same synchronous step as that check and keeps it through the save
   *   and the reload, so playback can't start in between and be cut off.
   *   Deferring the reload until playback stops was rejected: it would start
   *   right when the performer may press play.
   *
   * Moves are serialized (`moveInFlightRef`), so the order computed here is
   * always the order the save will produce - which is what makes the "does
   * this need a reload?" decision above reliable.
   */
  function handleMoveStem(stemId: string, direction: "up" | "down") {
    if (!entry?.sourceDir || moveInFlightRef.current) return;
    const sourceDir = entry.sourceDir;
    const projectId = entry.id;
    const ids = entry.tracks.map((track) => track.id);
    const index = ids.indexOf(stemId);
    if (index < 0) return;
    const expected = moveId(ids, index, direction);
    if (expected === ids) return; // already at that end of the list
    const needsReload = nowPlayingStore.needsReloadToReorder(
      projectId,
      expected,
    );
    if (needsReload && transportIsRunning()) {
      setFormError(t.project.lockedWhilePlayingBody);
      return;
    }
    const releasePlayback = needsReload ? nowPlayingStore.holdPlayback() : null;
    const generation = nowPlayingStore.loadGeneration();
    moveInFlightRef.current = true;
    setMoveInFlight(true);
    setFormError(null);
    (async () => {
      const updated = await moveStemInProject(sourceDir, stemId, direction);
      dispatch(
        projectUpdated({ id: projectId, changes: { tracks: updated.tracks } }),
      );
      const patched = nowPlayingStore.reorderTracksLocal(
        projectId,
        updated.tracks.map((track) => track.id),
      );
      if (patched || nowPlayingStore.getSnapshot().projectId !== projectId) {
        return;
      }
      // Only a reload can apply this order to the loaded project. Holding the
      // play lock means the transport is still stopped. Without one, the move
      // was expected to patch in place, so this is unexpected - reload only
      // if that's safe right now, never under a playing song.
      if (!releasePlayback && transportIsRunning()) {
        if (mountedRef.current) setFormError(t.project.lockedWhilePlayingBody);
        return;
      }
      const releaseForReload = releasePlayback
        ? null
        : nowPlayingStore.holdPlayback();
      if (mountedRef.current) setBusy(true);
      try {
        await reloadAndSeed(generation);
      } finally {
        releaseForReload?.();
        if (mountedRef.current) {
          setBusy(false);
          setStatus(null);
        }
      }
    })()
      .catch((e) => {
        if (mountedRef.current)
          setFormError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        releasePlayback?.();
        moveInFlightRef.current = false;
        if (mountedRef.current) setMoveInFlight(false);
      });
  }

  async function handleSubmit(values: ProjectFormValues) {
    if (transportIsRunning()) {
      setFormError(t.project.lockedWhilePlayingBody);
      return;
    }
    if (!entry?.sourceDir) return;
    // Held through the manifest write and the reload - see handleAddStems.
    const releasePlayback = nowPlayingStore.holdPlayback();
    const generation = nowPlayingStore.loadGeneration();
    setBusy(true);
    setFormError(null);
    try {
      await updateProjectMetadata(entry.sourceDir, values);
      dispatch(projectUpdated({ id: entry.id, changes: values }));
      setEditing(false);
      // bpm may have changed, which adds or removes the click entirely.
      await reloadAndSeed(generation);
    } catch (e) {
      if (mountedRef.current)
        setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      releasePlayback();
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
    if (!entry || entry.origin !== "filesystem" || entry.tracks.length > 0)
      return;
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
   * Jumps to a different song - previous/next, or one picked from the song
   * list (see `songSequence`) - without detouring back through the Library.
   * `replace`, not `push` - so paging through an entire set doesn't stack a
   * screen per song; Back from wherever you stop should return to the
   * Library, not step backward through every song already passed on the way
   * there. `autoPlay` rides along as a route param read by the effect that
   * loads the new screen - see its "Play next" comment.
   *
   * Stops the engine immediately, before any of that. The old song's actual
   * teardown otherwise only happens once the *new* one finishes loading
   * (`loadProject` rebuilds the graph atomically - see AGENTS.md), and
   * decoding a project is real, sometimes multi-second work - without an
   * explicit stop here, the outgoing song would keep audibly playing for
   * however long that takes, then abruptly cut over. A definite stop now,
   * even with a beat of silence while the next one loads, beats an
   * unpredictable overlap. Safe to call unconditionally: every caller of
   * this function is gated behind `isCurrent` already (see the header's
   * song controls), so the engine is always playing *this* project when it
   * fires.
   */
  function handleSwitchToSong(
    nextProjectId: string,
    options?: { autoPlay?: boolean },
  ) {
    audioEngine.stop();
    discardIfEmptyDraft();
    teardownAndNavigate(() =>
      router.replace({
        pathname: "/project/[projectId]",
        params: {
          projectId: nextProjectId,
          ...(folderId ? { folderId } : {}),
          ...(options?.autoPlay ? { autoPlay: "1" } : {}),
        },
      }),
    );
  }

  /**
   * The song list drawer's one CTA that's more than "load and stop where
   * every other jump leaves you": load the next song in the list and carry
   * straight on playing, for a set with no gap between songs. Allowed while
   * playing, because it takes two deliberate taps (open the list, press it).
   */
  function handlePlayNextSong() {
    if (!nextSongId) return;
    setSongListOpen(false);
    handleSwitchToSong(nextSongId, { autoPlay: true });
  }

  /**
   * The header's one-tap previous/next. Loads the song and leaves it
   * stopped, ready to play - the performer still starts it.
   *
   * Only while the transport isn't running: one tap next to the title is
   * easy to hit by accident, and mid-song that would cut the band off. A
   * song that has ended has stopped, so stepping on from there needs no
   * extra tap. Checked against the engine itself, not `isPlaying` - see
   * `transportIsRunning`. Changing songs mid-song is still possible through
   * the Songs list, which takes two deliberate taps.
   */
  function handleStepSong(targetId: string | null) {
    if (!targetId || transportIsRunning()) return;
    handleSwitchToSong(targetId);
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
  // The loaded waveforms, when this is the current project, so each track in
  // the editor shows its audio like a DAW lane. Matched by id, not position,
  // so they follow a track through a move.
  const peaksById = new Map(
    isCurrent ? nowPlaying.waveformTracks.map((w) => [w.id, w.peaks]) : [],
  );
  const formStems = (entry?.tracks ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    peaks: peaksById.get(t.id),
  }));
  const headerTitle =
    (isCurrent ? nowPlaying.manifest?.title : undefined) ?? entry?.title ?? "";

  // Desktop keyboard shortcuts (a no-op on the phone). Each key only does
  // what its button could do right now: nothing while editing, loading or
  // showing an error, no click toggle without a tempo, and previous/next
  // through handleStepSong, so they stay locked while playing.
  const songReady =
    isCurrent && !!nowPlaying.manifest && !editing && !loading && !error;
  useSongScreenShortcuts({
    toggleMixer: () => {
      if (songReady) setMixerOpen((open) => !open);
    },
    toggleLyrics: () => {
      if (songReady) handleSetLyricsView(!showLyrics);
    },
    toggleClick: () => {
      if (songReady && nowPlaying.manifest?.bpm !== undefined) {
        handleClickEnabledChange(!clickEnabled);
      }
    },
    previousSong: () => {
      if (songReady) handleStepSong(previousSongId);
    },
    nextSong: () => {
      if (songReady) handleStepSong(nextSongId);
    },
  });

  function renderHeader() {
    // Collapsed while viewing lyrics, to give the auto-scrolling text as
    // much of the screen as it reasonably can: the song's position in its
    // list is hidden and the header's own padding shrinks. The title itself
    // stays the same size in both views - it's the one piece of chrome
    // that's still the same "which song is this" answer either way, so it
    // must not be the thing that visibly changes underneath the reader. The
    // controls are unchanged either way - those are still needed while
    // reading lyrics. No animation on the switch, matching AGENTS.md's
    // `animation: 'none'` precedent.
    //
    // Every Pressable here keeps static children, with press feedback in
    // `style` - previous/next and Back navigate, and a function child there
    // is exactly the Fabric crash AGENTS.md documents.
    const compact = showLyrics;
    const showControls = isCurrent && nowPlaying.manifest && !editing;
    const stepLocked = isPlaying;
    const listName = folder?.name ?? t.project.backToLibrary;
    return (
      <View style={[styles.header, compact && styles.headerCompact]}>
        <View style={styles.headerTopRow}>
          <BackButton
            label={t.project.backToLibrary}
            onPress={handleBackFromProject}
            testID="back-button"
          />
          <View style={styles.headerActions}>
            {/* Edit sits up here with the song's other "between songs"
                actions, out of the toolbar the performer uses mid-song.
                Shown but inert while playing - editing can rebuild the audio
                graph, and a greyed-out button explains itself where a
                missing one would just be confusing. */}
            {showControls && canEdit && (
              <Pressable
                onPress={handleStartEditing}
                disabled={isPlaying}
                style={({ pressed }) => [
                  styles.toolButton,
                  isPlaying && styles.stepButtonDisabled,
                  pressed && styles.pressed,
                ]}
                hitSlop={6}
                testID="edit-button"
                accessibilityLabel={t.project.edit}
                accessibilityState={{ disabled: isPlaying }}
                accessibilityHint={
                  isPlaying ? t.project.lockedWhilePlaying : undefined
                }
              >
                <Text style={styles.toolButtonText}>{t.project.edit}</Text>
              </Pressable>
            )}
            {showControls && songSequence.length > 0 && (
              <Pressable
                onPress={() => setSongListOpen(true)}
                style={({ pressed }) => [
                  styles.toolButton,
                  pressed && styles.pressed,
                ]}
                hitSlop={6}
                testID="song-list-menu-button"
                accessibilityLabel={t.project.songs}
              >
                <Text style={styles.toolButtonText}>{t.project.songs}</Text>
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.titleRow}>
          {showControls && (
            <Pressable
              onPress={() => handleStepSong(previousSongId)}
              disabled={!previousSongId || stepLocked}
              style={({ pressed }) => [
                styles.stepButton,
                (!previousSongId || stepLocked) && styles.stepButtonDisabled,
                pressed && styles.pressed,
              ]}
              testID="previous-song-button"
              accessibilityLabel={t.project.previousSong}
              accessibilityHint={
                stepLocked ? t.project.switchLockedWhilePlaying : undefined
              }
            >
              <Chevron
                direction="left"
                color={colors.textPrimary}
                size={11}
                style={styles.chevronLeft}
              />
            </Pressable>
          )}
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={1}>
              {headerTitle}
            </Text>
            {showControls && !compact && sequenceIndex >= 0 && (
              <Text
                style={styles.position}
                numberOfLines={1}
                testID="song-position"
              >
                {t.project.songPosition(sequenceIndex + 1, songSequence.length)}
                {" · "}
                {listName}
              </Text>
            )}
          </View>
          {showControls && (
            <Pressable
              onPress={() => handleStepSong(nextSongId)}
              disabled={!nextSongId || stepLocked}
              style={({ pressed }) => [
                styles.stepButton,
                (!nextSongId || stepLocked) && styles.stepButtonDisabled,
                pressed && styles.pressed,
              ]}
              testID="next-song-button"
              accessibilityLabel={t.project.nextSong}
              accessibilityHint={
                stepLocked ? t.project.switchLockedWhilePlaying : undefined
              }
            >
              <Chevron
                direction="right"
                color={colors.textPrimary}
                size={11}
                style={styles.chevronRight}
              />
            </Pressable>
          )}
        </View>

        {showControls && (
          <View style={styles.toolbar}>
            {/* Tracks/Lyrics: two views of the same song, so a segmented
                switch. Markers/Mixer open a drawer over the current view. */}
            <View style={styles.segmented} testID="view-switch-group">
              <Pressable
                onPress={() => handleSetLyricsView(false)}
                style={({ pressed }) => [
                  styles.segment,
                  !showLyrics && styles.segmentActive,
                  pressed && styles.pressed,
                ]}
                testID="waveform-view-button"
                accessibilityLabel={t.project.tracksView}
                accessibilityState={{ selected: !showLyrics }}
              >
                <Text
                  style={[
                    styles.segmentText,
                    !showLyrics && styles.segmentTextActive,
                  ]}
                >
                  {t.project.tracksView}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => handleSetLyricsView(true)}
                style={({ pressed }) => [
                  styles.segment,
                  showLyrics && styles.segmentActive,
                  pressed && styles.pressed,
                ]}
                testID="lyrics-toggle-button"
                accessibilityLabel={t.lyrics.toggleLabel}
                accessibilityState={{ selected: showLyrics }}
              >
                <Text
                  style={[
                    styles.segmentText,
                    showLyrics && styles.segmentTextActive,
                  ]}
                >
                  {t.lyrics.toggleLabel}
                </Text>
              </Pressable>
            </View>
            <View style={styles.toolbarSpacer} />
            <Pressable
              onPress={() => setMarkersOpen(true)}
              style={({ pressed }) => [
                styles.toolButton,
                pressed && styles.pressed,
              ]}
              testID="markers-menu-button"
              accessibilityLabel={t.markers.heading}
            >
              <Text style={styles.toolButtonText}>{t.markers.heading}</Text>
            </Pressable>
            <Pressable
              onPress={() => setMixerOpen(true)}
              style={({ pressed }) => [
                styles.toolButton,
                pressed && styles.pressed,
              ]}
              testID="mixer-menu-button"
              accessibilityLabel={t.project.mixer}
            >
              <Text style={styles.toolButtonText}>{t.project.mixer}</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  if (editing) {
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
          onMoveStem={handleMoveStem}
          movesDisabled={moveInFlight}
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
            replace the offending stem - matters most. The header's Edit only shows for a
            loaded song, so it's offered here as well. */}
        {canEdit && (
          <View style={styles.errorActions}>
            <HeaderButton
              label={t.project.edit}
              onPress={handleStartEditing}
              testID="edit-button"
            />
          </View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {renderHeader()}

      <View style={styles.waveformArea}>
        {showLyrics ? (
          <LyricsView
            lyrics={nowPlaying.manifest.lyrics ?? ""}
            syncPoints={nowPlaying.manifest.lyricsSyncPoints ?? []}
            durationSec={nowPlaying.durationSec}
            playheadSec={playheadSec}
            fontSizePt={lyricsFontSizePt}
            allCaps={lyricsAllCaps}
            onEdit={() => setLyricsEditorOpen(true)}
            onTapLine={handleTapLyricsLine}
            onOpenSync={() => setLyricsSyncOpen(true)}
            onFontSizeChange={handleLyricsFontSizeChange}
            onAllCapsChange={handleLyricsAllCapsChange}
          />
        ) : (
          <WaveformView
            projectId={entry.id}
            tracks={nowPlaying.waveformTracks}
            durationSec={nowPlaying.durationSec}
            playheadSec={playheadSec}
            bpm={nowPlaying.manifest.bpm}
            sections={nowPlaying.manifest.sections}
          />
        )}
      </View>

      <MarkersDrawer
        visible={markersOpen}
        onClose={() => setMarkersOpen(false)}
        sections={nowPlaying.manifest.sections}
        playheadSec={playheadSec}
        onAdd={handleAddMarker}
        onRemove={handleRemoveMarker}
        onJump={handleJumpToMarker}
      />

      <SongListDrawer
        visible={songListOpen}
        onClose={() => setSongListOpen(false)}
        title={folder?.name ?? t.project.backToLibrary}
        songs={songSequence}
        currentProjectId={entry?.id}
        onJump={(nextProjectId) => {
          setSongListOpen(false);
          handleSwitchToSong(nextProjectId);
        }}
        onPlayNext={nextSongId ? handlePlayNextSong : undefined}
      />

      <LyricsDrawer
        visible={lyricsEditorOpen}
        onClose={() => setLyricsEditorOpen(false)}
        lyrics={nowPlaying.manifest.lyrics ?? ""}
        onSave={handleSaveLyrics}
      />

      <LyricsSyncDrawer
        visible={lyricsSyncOpen}
        onClose={() => setLyricsSyncOpen(false)}
        lyrics={nowPlaying.manifest.lyrics ?? ""}
        syncPoints={nowPlaying.manifest.lyricsSyncPoints ?? []}
        onRemoveOne={handleRemoveLyricsSyncPoint}
        onClearAll={handleClearLyricsSync}
      />

      <MixerDrawer
        visible={mixerOpen}
        onClose={() => setMixerOpen(false)}
        manifest={nowPlaying.manifest}
        monitorMode={monitorMode}
        onMonitorModeChange={handleMonitorModeChange}
        clickEnabled={clickEnabled}
        onClickEnabledChange={handleClickEnabledChange}
        // Hidden while playing: an export is a thing you do between sets -
        // there's nothing useful to say about it mid-song.
        onExport={entry?.sourceDir && !isPlaying ? handleExport : undefined}
      />
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
    // While viewing lyrics: shrinks the header down to just the controls row
    // and a compact title, reclaiming vertical space for the auto-scrolling
    // text - see renderHeader's `compact` comment.
    headerCompact: {
      paddingTop: spacing.xs,
      paddingBottom: spacing.xs,
    },
    headerTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.xs,
    },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    titleBlock: {
      flex: 1,
      alignItems: "center",
    },
    title: {
      color: colors.textPrimary,
      fontSize: 22,
      fontWeight: "800",
      letterSpacing: -0.3,
    },
    position: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: "600",
      marginTop: 2,
    },
    stepButton: {
      width: 48,
      height: 44,
      borderRadius: radii.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    stepButtonDisabled: {
      opacity: 0.3,
    },
    // The chevron is a rotated corner; nudge it so it reads as centred.
    chevronLeft: {
      marginLeft: 4,
    },
    chevronRight: {
      marginRight: 4,
    },
    toolbar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    toolbarSpacer: {
      flex: 1,
    },
    segmented: {
      flexDirection: "row",
      borderRadius: radii.md,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    segment: {
      minHeight: 36,
      paddingHorizontal: spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    segmentActive: {
      backgroundColor: colors.accent,
    },
    segmentText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: "700",
    },
    // `surface` inverts the same way `accent` does, so it reads on both.
    segmentTextActive: {
      color: colors.surface,
    },
    toolButton: {
      minHeight: 36,
      paddingHorizontal: spacing.md,
      borderRadius: radii.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    toolButtonText: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: "700",
    },
    pressed: {
      opacity: 0.6,
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
}
