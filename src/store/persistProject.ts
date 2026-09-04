import { patchProjectManifest } from '@/storage';
import type { LyricsSyncPoint, ProjectManifest, SectionManifest, TrackManifest } from '@/types/project';
import type { AppDispatch, RootState } from './index';
import { projectUpdated, projectsSelectors } from './projectsSlice';
import { trackEntityId, tracksSelectors } from './tracksSlice';

/**
 * Writes the project's current mixer state back to its manifest.json.
 *
 * Called after every *committed* change - a fader release, a mute/solo/bus
 * tap, the click toggle - never during a drag, so writes stay user-paced
 * rather than per-frame. The manifest is small, so this is cheap enough to do
 * synchronously with the change instead of debouncing; that way there is no
 * window where the app can be closed with the last change still unwritten.
 *
 * Bundled projects live in the app bundle with no writable manifest, so they
 * keep their state in memory only.
 */
export function persistProjectMixer(projectId: string) {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState();
    const entry = projectsSelectors.selectById(state.projects, projectId);
    if (!entry?.sourceDir) return;

    const tracks: TrackManifest[] = entry.tracks.map((track) => {
      const committed = tracksSelectors.selectById(
        state.tracks,
        trackEntityId(projectId, track.id)
      );
      if (!committed) return track;
      return {
        ...track,
        gain: committed.volume,
        bus: committed.bus,
        muted: committed.muted,
        soloed: committed.soloed,
      };
    });

    dispatch(projectUpdated({ id: projectId, changes: { tracks } }));
    writeManifest(entry.sourceDir, { tracks });
  };
}

/** Persists the per-project click toggle. */
export function persistProjectClick(projectId: string, clickEnabled: boolean) {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    const entry = projectsSelectors.selectById(getState().projects, projectId);
    dispatch(projectUpdated({ id: projectId, changes: { clickEnabled } }));
    if (!entry?.sourceDir) return;
    writeManifest(entry.sourceDir, { clickEnabled });
  };
}

/**
 * Persists a project's markers ("sections" in the manifest - see
 * types/project.ts). Not gated on the transport running: like a stem
 * rename, this only rewrites data in the manifest and never touches the
 * audio graph, so adding/removing a marker mid-song is safe.
 */
export function persistProjectSections(projectId: string, sections: SectionManifest[]) {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    const entry = projectsSelectors.selectById(getState().projects, projectId);
    dispatch(projectUpdated({ id: projectId, changes: { sections } }));
    if (!entry?.sourceDir) return;
    writeManifest(entry.sourceDir, { sections });
  };
}

/**
 * Persists a project's lyrics text. Not gated on the transport running:
 * like a marker or a stem rename, this only rewrites data in the manifest
 * and never touches the audio graph, so editing lyrics mid-song is safe.
 *
 * Resets `lyricsSyncPoints` to empty - a line count/order change in the new
 * text can make old per-line tap timings point at the wrong line, so they're
 * discarded rather than silently misapplied. See persistProjectLyricsSync
 * for the (separate, much more frequent) tap-correction writes.
 */
export function persistProjectLyrics(projectId: string, lyrics: string) {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    const entry = projectsSelectors.selectById(getState().projects, projectId);
    dispatch(projectUpdated({ id: projectId, changes: { lyrics, lyricsSyncPoints: [] } }));
    if (!entry?.sourceDir) return;
    writeManifest(entry.sourceDir, { lyrics, lyricsSyncPoints: [] });
  };
}

/**
 * Persists the lyrics view's tap-to-correct sync points. Not gated on the
 * transport running - tapping a line to fix its timing is meant to work
 * mid-song, same reasoning as persistProjectSections.
 */
export function persistProjectLyricsSync(projectId: string, syncPoints: LyricsSyncPoint[]) {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    const entry = projectsSelectors.selectById(getState().projects, projectId);
    dispatch(projectUpdated({ id: projectId, changes: { lyricsSyncPoints: syncPoints } }));
    if (!entry?.sourceDir) return;
    writeManifest(entry.sourceDir, { lyricsSyncPoints: syncPoints });
  };
}

/**
 * Failing to persist must never interrupt playback - the change is already
 * live in the engine and the store, and losing it only costs the user a
 * re-tweak next time. Warn and carry on rather than surfacing an error
 * mid-performance.
 */
function writeManifest(sourceDir: string, changes: Partial<ProjectManifest>) {
  patchProjectManifest(sourceDir, changes).catch((error) => {
    console.warn('Failed to persist project manifest changes', Object.keys(changes), error);
  });
}
