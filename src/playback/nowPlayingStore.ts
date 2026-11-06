import { audioEngine, type MonitorMode } from "@/engine";
import { trackRuntimeStatesFromManifest } from "@/engine/trackRuntimeState";
import { computeWaveformPeaks, waveformBarCount } from "@/engine/waveform";
import { decodeProjectAudio, getProjectSourceForEntry } from "@/storage";
import { report, type ProgressReporter } from "@/storage/progress";
import type { LibraryProjectEntry } from "@/store/projectsSlice";
import type {
  LyricsSyncPoint,
  ProjectManifest,
  SectionManifest,
} from "@/types/project";
import type { StemWaveform } from "@/ui/components/WaveformView";
import { getTrackColor } from "@/ui/trackColors";

/** Bounds the number of stem waveform lanes rendered - past this, only the mixer's per-track strips show the rest. */
const MAX_WAVEFORM_STEMS = 16;

export interface NowPlayingSnapshot {
  projectId: string | null;
  manifest: ProjectManifest | null;
  durationSec: number;
  waveformTracks: StemWaveform[];
  /**
   * The folder this project was last opened from, if any - set by
   * `setFolderContext()` and forwarded by `NowPlayingBar`'s `goToSong()`,
   * so jumping back into the Player from the mini-player after navigating
   * away still shows the "songs in this folder" list instead of silently
   * losing it. Reset to `null` whenever a *different* project loads, since
   * a fresh project has no folder context until told otherwise.
   */
  folderId: string | null;
  /**
   * True while playback is locked - a load or reload is decoding and
   * rebuilding the engine, or an edit that ends in one is under way. Every
   * load ends in `audioEngine.loadProject()`, which stops and replaces the
   * transport, so playback started meanwhile would be cut off the moment it
   * finishes. See `canStartPlayback()`/`holdPlayback()`.
   */
  loading: boolean;
}

interface EngineOptions {
  monitorMode: MonitorMode;
  clickEnabled: boolean;
}

interface LoadResult {
  manifest: ProjectManifest;
  durationSec: number;
}

/** A load that a newer `openProject`/`reload` overtook before it committed. */
class SupersededLoadError extends Error {
  constructor() {
    super("Superseded by a newer openProject/reload call");
    this.name = "SupersededLoadError";
  }
}

const EMPTY_SNAPSHOT: NowPlayingSnapshot = {
  projectId: null,
  manifest: null,
  durationSec: 0,
  waveformTracks: [],
  folderId: null,
  loading: false,
};

/**
 * Tracks which project is currently loaded into `audioEngine`, so playback
 * can survive navigating away from its detail screen (Library, editing, a
 * different project's own error state) instead of being tied to
 * ProjectScreen's mount lifecycle.
 *
 * A plain singleton (same shape as `audioEngine` itself) wrapped by
 * `useNowPlaying()`'s `useSyncExternalStore`, not Redux and not Context:
 * this holds a `Float32Array` per stem (waveform peaks), which doesn't
 * belong in serializable Redux state, and it must never read or dispatch to
 * the module-level `@/store` singleton directly - tests (and any future
 * multiply-mounted tree) render against their own `createStore()` instance,
 * which is exactly the hazard `ProjectScreen`'s loader effect already
 * documents for why it derives from the decoded manifest instead of
 * reading the store back. Callers own all Redux reads/writes; this only
 * wraps `audioEngine` and caches the decode/waveform result.
 */
class NowPlayingStore {
  private snapshot: NowPlayingSnapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<() => void>();
  private requestId = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): NowPlayingSnapshot => this.snapshot;

  /**
   * Which project the user last asked for, and a counter bumped on every
   * such request - see `reloadUnlessSuperseded`. Kept apart from
   * `requestId`, which only counts actual loads: opening the song that's
   * already loaded is still the user choosing it, but must not supersede a
   * reload of it that's still in flight (that would drop the edit it
   * carries).
   */
  private intentGeneration = 0;
  private intendedProjectId: string | null = null;

  private recordIntent(projectId: string | null): void {
    this.intentGeneration += 1;
    this.intendedProjectId = projectId;
  }

  /** Outstanding `holdPlayback()` holds - see `canStartPlayback()`. */
  private playbackHolds = 0;

  private commit(next: NowPlayingSnapshot): void {
    // Derived, never set directly: true exactly while something holds the
    // lock, whatever the caller passed in.
    this.snapshot = { ...next, loading: this.playbackHolds > 0 };
    for (const listener of this.listeners) listener();
  }

  /**
   * Loads `entry` into the engine, unless it's already the current project -
   * in that case this is a no-op that resolves with what's already loaded,
   * leaving playback completely untouched. That's the core of "audio
   * survives navigating back to the same project".
   */
  async openProject(
    entry: LibraryProjectEntry,
    options: EngineOptions,
    onProgress?: ProgressReporter,
  ): Promise<LoadResult> {
    if (entry.id === this.snapshot.projectId && this.snapshot.manifest) {
      // No load, but still the user choosing this song - an edit of another
      // song that finishes later must not take them away from it.
      this.recordIntent(entry.id);
      return {
        manifest: this.snapshot.manifest,
        durationSec: this.snapshot.durationSec,
      };
    }
    return this.loadFresh(entry, options, onProgress);
  }

  /**
   * Forces a fresh decode of `entry` even if it's already current - used
   * after add/remove-stem or a bpm edit, since the content itself changed.
   */
  async reload(
    entry: LibraryProjectEntry,
    options: EngineOptions,
    onProgress?: ProgressReporter,
  ): Promise<LoadResult> {
    return this.loadFresh(entry, options, onProgress);
  }

  /**
   * A marker for "songs the user has asked for so far" - every
   * `openProject`/`reload`, including opening the already-loaded song. An
   * edit takes one when it starts and hands it to `reloadUnlessSuperseded`
   * when it finishes.
   */
  loadGeneration(): number {
    return this.intentGeneration;
  }

  /**
   * `reload()`, unless a *different* project has been asked for since
   * `generation` - opened (even if it was already the loaded one, so no load
   * ran), or the loaded project was closed - then it does nothing and
   * resolves to null.
   *
   * Edits (adding/removing stems, saving the song info) keep running after
   * the user navigates away, and only reload once their disk work is done -
   * which can take long enough for the user to have gone back and opened
   * another song meanwhile. Reloading the edited song then would supersede
   * the song the user actually chose, and leave the edited one loaded
   * instead. The edit's disk change is already saved either way; the edited
   * song picks it up the next time it's opened, since opening a song that
   * isn't the loaded one always decodes it fresh from disk.
   *
   * A newer request for the *same* project doesn't count: reloading it
   * still ends with the project the user is looking at, now with the edit.
   */
  async reloadUnlessSuperseded(
    entry: LibraryProjectEntry,
    options: EngineOptions,
    generation: number,
    onProgress?: ProgressReporter,
  ): Promise<LoadResult | null> {
    if (
      this.intentGeneration !== generation &&
      this.intendedProjectId !== entry.id
    ) {
      return null;
    }
    return this.loadFresh(entry, options, onProgress);
  }

  /**
   * Whether playback may start right now. False while anything holds the
   * lock (`holdPlayback()`): every load and reload, and every edit that will
   * end in one. A load ends in `audioEngine.loadProject()`, which stops the
   * transport, so a song started meanwhile would be cut off - on stage, with
   * the performer having pressed play on purpose. Every control that starts
   * playback (NowPlayingBar's play button, the desktop play shortcut) checks
   * this. The lock never stops anything already playing.
   */
  canStartPlayback(): boolean {
    return this.playbackHolds === 0;
  }

  /**
   * Keeps playback from starting until the returned release is called
   * (idempotent). Every load holds it for its whole run. An edit that will
   * end in a reload - adding or removing a stem, saving the song info - must
   * take it in the same synchronous step as its "is the transport stopped?"
   * check, before awaiting anything (a file picker, a copy, a manifest
   * write), and release it once its reload is done: otherwise the song could
   * be started during that wait and then cut off by the reload.
   *
   * A count, not a flag, so overlapping holders (an edit and its own
   * reload; two loads, one superseding the other) never release each other's
   * lock early.
   */
  holdPlayback(): () => void {
    this.playbackHolds += 1;
    this.commit(this.snapshot);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.playbackHolds -= 1;
      this.commit(this.snapshot);
    };
  }

  /**
   * The newest load request and its result - lets a load superseded by a
   * newer load of the *same* project resolve with that newer result instead
   * of failing (see `loadFresh`).
   */
  private latestLoad: {
    requestId: number;
    projectId: string;
    promise: Promise<LoadResult>;
  } | null = null;

  /**
   * Superseded by a newer load of the same project: resolves with that newer
   * load's result rather than rejecting. The caller asked for this project,
   * and the newer load delivers it - typically an edit's reload (after an
   * add/remove/save) landing while the user had just re-opened the song, so
   * the song screen's own open would otherwise show a permanent "load
   * failed" while the reload loads the song fine. Superseded by a load of a
   * *different* project (or by `closeIfCurrent`), it still rejects.
   */
  private loadFresh(
    entry: LibraryProjectEntry,
    options: EngineOptions,
    onProgress?: ProgressReporter,
  ): Promise<LoadResult> {
    const requestId = ++this.requestId;
    this.recordIntent(entry.id);
    // Taken synchronously, before the first await, so there's no gap between
    // a caller checking the transport and the lock taking effect.
    const release = this.holdPlayback();
    const promise = (async () => {
      try {
        return await this.decodeAndLoad(entry, options, requestId, onProgress);
      } catch (error) {
        const latest = this.latestLoad;
        if (
          error instanceof SupersededLoadError &&
          latest &&
          latest.requestId !== requestId &&
          latest.projectId === entry.id
        ) {
          return await latest.promise;
        }
        throw error;
      } finally {
        release();
      }
    })();
    this.latestLoad = { requestId, projectId: entry.id, promise };
    return promise;
  }

  /**
   * Whether a load must not install itself: a newer load was requested, or
   * the user has since chosen a different song without one - re-opening
   * the already-loaded song takes `openProject`'s fast path, which runs no
   * load but records the choice. Without the second half, a slower load of
   * another song still in flight would replace the song the user just went
   * back to. A load always starts by recording its own project as the
   * choice, so only a later, different choice rejects it - re-opening the
   * same song never cancels a reload of that song (which may carry an edit).
   */
  private isStale(requestId: number, projectId: string): boolean {
    return requestId !== this.requestId || this.intendedProjectId !== projectId;
  }

  private async decodeAndLoad(
    entry: LibraryProjectEntry,
    { monitorMode, clickEnabled }: EngineOptions,
    requestId: number,
    onProgress?: ProgressReporter,
  ): Promise<LoadResult> {
    const source = await getProjectSourceForEntry(entry);
    const decoded = await decodeProjectAudio(
      audioEngine.context,
      source,
      onProgress,
    );

    // Bail out early if this request is already stale - no point computing
    // waveforms for it. Not the check that matters, though: see below.
    if (this.isStale(requestId, entry.id)) {
      throw new SupersededLoadError();
    }

    const durationSec = source.manifest.tracks.reduce(
      (max, t) => Math.max(max, decoded.trackBuffers[t.id]?.duration ?? 0),
      0,
    );

    // Peak computation walks every sample of every stem, synchronously. It
    // only reads the decoded buffers, never the engine, so it's done before
    // the engine is touched - keeping every yield to the UI ahead of the
    // final check below.
    await report(onProgress, { phase: "waveforms" });
    const waveformStems = source.manifest.tracks.slice(0, MAX_WAVEFORM_STEMS);
    const laneBarCount = waveformBarCount(durationSec, waveformStems.length);
    const waveformTracks: StemWaveform[] = waveformStems.map(
      (track, index) => ({
        id: track.id,
        name: track.name,
        color: getTrackColor(index),
        peaks: decoded.trackBuffers[track.id]
          ? computeWaveformPeaks(
              [decoded.trackBuffers[track.id]],
              durationSec,
              laneBarCount,
            )
          : new Float32Array(laneBarCount),
      }),
    );

    // Building the graph also generates the click track, which is a
    // synchronous pass over the whole project length - this yield lets the
    // "building" label paint first. It's the last await in this function.
    await report(onProgress, { phase: "building" });

    // The check that matters: a slower, now-superseded request must never
    // win - most importantly, must never clobber a *different* project the
    // user has asked for since (e.g. they opened another song during one of
    // the yields above). From here to the commit everything is synchronous,
    // so no newer request can arrive between this check, replacing the
    // engine's graph and publishing the snapshot - the graph and the
    // snapshot always describe the same, current project.
    if (this.isStale(requestId, entry.id)) {
      throw new SupersededLoadError();
    }
    audioEngine.loadProject(
      decoded,
      trackRuntimeStatesFromManifest(source.manifest.tracks),
    );
    audioEngine.setMonitorMode(monitorMode);
    audioEngine.setClickEnabled(clickEnabled);

    this.commit({
      projectId: entry.id,
      manifest: source.manifest,
      durationSec,
      waveformTracks,
      // A freshly-loaded project starts with no remembered folder context -
      // set explicitly afterwards by `setFolderContext()` if it was opened
      // from one.
      folderId: null,
      loading: false,
    });
    return { manifest: source.manifest, durationSec };
  }

  /**
   * Records which folder (if any) the currently-loaded project was opened
   * from, so `NowPlayingBar`'s `goToSong()` can carry that folder context
   * forward when jumping back into the Player after the user has navigated
   * away and the folder is no longer on the route. A no-op if `projectId`
   * isn't the project currently loaded (a stale caller, e.g. from a load
   * that's since been superseded).
   */
  setFolderContext(projectId: string, folderId: string): void {
    if (this.snapshot.projectId !== projectId) return;
    if (this.snapshot.folderId === folderId) return;
    this.commit({ ...this.snapshot, folderId });
  }

  /**
   * Stops and clears the snapshot, but only if `projectId` is the one
   * currently loaded - called before deleting a project, so a deleted
   * project never keeps playing or lingers in the mini-player/Library.
   */
  closeIfCurrent(projectId: string): void {
    if (this.snapshot.projectId !== projectId) return;
    audioEngine.stop();
    this.requestId++; // also supersedes any load still in flight for it
    this.latestLoad = null;
    this.recordIntent(null);
    this.commit(EMPTY_SNAPSHOT);
  }

  /**
   * Patches a track's display name in place after a successful rename write -
   * no re-decode needed.
   *
   * A no-op unless `projectId` is still the loaded project. The rename's
   * write is async and can queue behind other manifest edits, so it may land
   * after the user has switched songs - and stem ids ("bass", "keys") are
   * routinely the same across songs, so patching by stem id alone would
   * silently rename a track in whatever song is loaded now.
   */
  renameTrackLocal(projectId: string, stemId: string, name: string): void {
    const { manifest, waveformTracks } = this.snapshot;
    if (!manifest || this.snapshot.projectId !== projectId) return;
    this.commit({
      ...this.snapshot,
      manifest: {
        ...manifest,
        tracks: manifest.tracks.map((t) =>
          t.id === stemId ? { ...t, name } : t,
        ),
      },
      waveformTracks: waveformTracks.map((t) =>
        t.id === stemId ? { ...t, name } : t,
      ),
    });
  }

  /**
   * Re-orders the current project's stems in place after a successful write -
   * no re-decode needed, same reasoning as `renameTrackLocal`: the engine keys
   * every stem by id and starts them all together, so order is display-only.
   * Lane colors follow position (as they do on a fresh load), so they're
   * re-assigned here too.
   *
   * Returns false, changing nothing, when the patch can't be done faithfully -
   * `projectId` isn't the loaded project, `trackIds` isn't exactly its stems,
   * or the move would bring a stem without a computed waveform (past
   * MAX_WAVEFORM_STEMS) into view. The caller should do a full `reload()`
   * then instead.
   */
  reorderTracksLocal(projectId: string, trackIds: string[]): boolean {
    const { manifest, waveformTracks } = this.snapshot;
    if (!manifest || this.snapshot.projectId !== projectId) return false;
    if (trackIds.length !== manifest.tracks.length) return false;

    const tracksById = new Map(manifest.tracks.map((t) => [t.id, t]));
    const tracks = trackIds.map((id) => tracksById.get(id));
    if (tracks.some((t) => t === undefined)) return false;

    const lanesById = new Map(waveformTracks.map((w) => [w.id, w]));
    const visibleIds = trackIds.slice(0, MAX_WAVEFORM_STEMS);
    if (this.missingLane(visibleIds)) return false;

    this.commit({
      ...this.snapshot,
      manifest: {
        ...manifest,
        tracks: tracks as ProjectManifest["tracks"],
      },
      waveformTracks: visibleIds.map((id, index) => ({
        ...lanesById.get(id)!,
        color: getTrackColor(index),
      })),
    });
    return true;
  }

  /**
   * Whether re-ordering the loaded project to `trackIds` would need a full
   * `reload()` - i.e. it brings a stem that has no computed waveform into the
   * visible lanes, which `reorderTracksLocal` can't do in place. Only ever
   * true for the loaded project and a project with more stems than lanes.
   * Lets a caller refuse such a move up front while the song is playing,
   * since a reload rebuilds the audio graph.
   */
  needsReloadToReorder(projectId: string, trackIds: string[]): boolean {
    if (!this.snapshot.manifest || this.snapshot.projectId !== projectId) {
      return false;
    }
    return this.missingLane(trackIds.slice(0, MAX_WAVEFORM_STEMS));
  }

  private missingLane(visibleIds: string[]): boolean {
    const laneIds = new Set(this.snapshot.waveformTracks.map((w) => w.id));
    return visibleIds.some((id) => !laneIds.has(id));
  }

  /** Patches the current project's markers in place after a successful write - no re-decode needed, same reasoning as `renameTrackLocal`. */
  setSectionsLocal(sections: SectionManifest[]): void {
    const { manifest } = this.snapshot;
    if (!manifest) return;
    this.commit({ ...this.snapshot, manifest: { ...manifest, sections } });
  }

  /**
   * Patches the current project's lyrics text in place after a successful
   * write - no re-decode needed, same reasoning as `setSectionsLocal`.
   * Resets `lyricsSyncPoints` too, mirroring persistProjectLyrics's reset.
   */
  setLyricsLocal(lyrics: string): void {
    const { manifest } = this.snapshot;
    if (!manifest) return;
    this.commit({
      ...this.snapshot,
      manifest: { ...manifest, lyrics, lyricsSyncPoints: [] },
    });
  }

  /** Patches the current project's lyrics tap-to-correct sync points in place - no re-decode needed, same reasoning as `setSectionsLocal`. */
  setLyricsSyncLocal(syncPoints: LyricsSyncPoint[]): void {
    const { manifest } = this.snapshot;
    if (!manifest) return;
    this.commit({
      ...this.snapshot,
      manifest: { ...manifest, lyricsSyncPoints: syncPoints },
    });
  }

  /**
   * Test-only: clears state between tests. Unlike `audioEngine` (which
   * self-resets every test because `loadProject()` always fully rebuilds
   * its graph regardless of prior state), this store's whole point is
   * skipping reload when the id already matches - which would silently
   * break test isolation across tests reusing the same project id unless
   * reset in `beforeEach`.
   */
  resetForTests(): void {
    this.requestId++;
    this.latestLoad = null;
    this.intentGeneration = 0;
    this.intendedProjectId = null;
    this.playbackHolds = 0;
    this.snapshot = EMPTY_SNAPSHOT;
  }
}

export const nowPlayingStore = new NowPlayingStore();
