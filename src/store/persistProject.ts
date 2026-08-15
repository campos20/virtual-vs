import { patchProjectManifest } from '@/storage';
import type { ProjectManifest, TrackManifest } from '@/types/project';
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
 * Failing to persist must never interrupt playback - the change is already
 * live in the engine and the store, and losing it only costs the user a
 * re-tweak next time. Warn and carry on rather than surfacing an error
 * mid-performance.
 */
function writeManifest(sourceDir: string, changes: Partial<ProjectManifest>) {
  patchProjectManifest(sourceDir, changes).catch((error) => {
    console.warn('Failed to persist project mixer state', error);
  });
}
