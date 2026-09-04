import { audioEngine, type MonitorMode } from '@/engine';
import { trackRuntimeStatesFromManifest } from '@/engine/trackRuntimeState';
import { computeWaveformPeaks, waveformBarCount } from '@/engine/waveform';
import { decodeProjectAudio, getProjectSourceForEntry } from '@/storage';
import { report, type ProgressReporter } from '@/storage/progress';
import type { LibraryProjectEntry } from '@/store/projectsSlice';
import type { LyricsSyncPoint, ProjectManifest, SectionManifest } from '@/types/project';
import type { StemWaveform } from '@/ui/components/WaveformView';
import { getTrackColor } from '@/ui/trackColors';

/** Bounds the number of stem waveform lanes rendered - past this, only the mixer's per-track strips show the rest. */
const MAX_WAVEFORM_STEMS = 16;

export interface NowPlayingSnapshot {
  projectId: string | null;
  manifest: ProjectManifest | null;
  durationSec: number;
  waveformTracks: StemWaveform[];
}

interface EngineOptions {
  monitorMode: MonitorMode;
  clickEnabled: boolean;
}

interface LoadResult {
  manifest: ProjectManifest;
  durationSec: number;
}

const EMPTY_SNAPSHOT: NowPlayingSnapshot = {
  projectId: null,
  manifest: null,
  durationSec: 0,
  waveformTracks: [],
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

  private commit(next: NowPlayingSnapshot): void {
    this.snapshot = next;
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
    onProgress?: ProgressReporter
  ): Promise<LoadResult> {
    if (entry.id === this.snapshot.projectId && this.snapshot.manifest) {
      return { manifest: this.snapshot.manifest, durationSec: this.snapshot.durationSec };
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
    onProgress?: ProgressReporter
  ): Promise<LoadResult> {
    return this.loadFresh(entry, options, onProgress);
  }

  private async loadFresh(
    entry: LibraryProjectEntry,
    { monitorMode, clickEnabled }: EngineOptions,
    onProgress?: ProgressReporter
  ): Promise<LoadResult> {
    const requestId = ++this.requestId;

    const source = await getProjectSourceForEntry(entry);
    const decoded = await decodeProjectAudio(audioEngine.context, source, onProgress);

    // A slower, now-superseded request resolving after a newer one already
    // committed must never win - most importantly, must never clobber a
    // *different* project that's since become current (e.g. the user
    // backed out before this one finished decoding and opened another).
    if (requestId !== this.requestId) {
      throw new Error('Superseded by a newer openProject/reload call');
    }

    // Building the graph also generates the click track, which is a
    // synchronous pass over the whole project length.
    await report(onProgress, { phase: 'building' });
    audioEngine.loadProject(decoded, trackRuntimeStatesFromManifest(source.manifest.tracks));
    audioEngine.setMonitorMode(monitorMode);
    audioEngine.setClickEnabled(clickEnabled);

    const durationSec = source.manifest.tracks.reduce(
      (max, t) => Math.max(max, decoded.trackBuffers[t.id]?.duration ?? 0),
      0
    );

    // Peak computation walks every sample of every stem, synchronously.
    await report(onProgress, { phase: 'waveforms' });
    const waveformStems = source.manifest.tracks.slice(0, MAX_WAVEFORM_STEMS);
    const laneBarCount = waveformBarCount(durationSec, waveformStems.length);
    const waveformTracks: StemWaveform[] = waveformStems.map((track, index) => ({
      id: track.id,
      name: track.name,
      color: getTrackColor(index),
      peaks: decoded.trackBuffers[track.id]
        ? computeWaveformPeaks([decoded.trackBuffers[track.id]], durationSec, laneBarCount)
        : new Float32Array(laneBarCount),
    }));

    this.commit({ projectId: entry.id, manifest: source.manifest, durationSec, waveformTracks });
    return { manifest: source.manifest, durationSec };
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
    this.commit(EMPTY_SNAPSHOT);
  }

  /** Patches a track's display name in place after a successful rename write - no re-decode needed. */
  renameTrackLocal(stemId: string, name: string): void {
    const { manifest, waveformTracks } = this.snapshot;
    if (!manifest) return;
    this.commit({
      ...this.snapshot,
      manifest: {
        ...manifest,
        tracks: manifest.tracks.map((t) => (t.id === stemId ? { ...t, name } : t)),
      },
      waveformTracks: waveformTracks.map((t) => (t.id === stemId ? { ...t, name } : t)),
    });
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
    this.commit({ ...this.snapshot, manifest: { ...manifest, lyrics, lyricsSyncPoints: [] } });
  }

  /** Patches the current project's lyrics tap-to-correct sync points in place - no re-decode needed, same reasoning as `setSectionsLocal`. */
  setLyricsSyncLocal(syncPoints: LyricsSyncPoint[]): void {
    const { manifest } = this.snapshot;
    if (!manifest) return;
    this.commit({ ...this.snapshot, manifest: { ...manifest, lyricsSyncPoints: syncPoints } });
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
    this.snapshot = EMPTY_SNAPSHOT;
  }
}

export const nowPlayingStore = new NowPlayingStore();
