import { createEntityAdapter, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Bus, TrackManifest } from '@/types/project';

/**
 * Committed per-track mixer state (volume/mute/solo/bus). This is the only
 * thing that gets dispatched here for volume - the live value during a
 * fader drag goes straight to the engine and is committed to this slice
 * only on release (see AGENTS.md state architecture rules). The live
 * playhead never lives here at all.
 */
export interface TrackCommittedState {
  /** `${projectId}:${trackId}` */
  id: string;
  projectId: string;
  trackId: string;
  volume: number;
  muted: boolean;
  soloed: boolean;
  bus: Bus;
}

export function trackEntityId(projectId: string, trackId: string): string {
  return `${projectId}:${trackId}`;
}

const tracksAdapter = createEntityAdapter<TrackCommittedState>();

const tracksSlice = createSlice({
  name: 'tracks',
  initialState: tracksAdapter.getInitialState(),
  reducers: {
    /**
     * Loads a project's committed mixer state from its manifest.
     *
     * This overwrites whatever was in the store, because the manifest is the
     * source of truth: every committed change is written straight back to it,
     * so it is always at least as fresh as the store.
     */
    tracksInitializedForProject(
      state,
      action: PayloadAction<{ projectId: string; tracks: TrackManifest[] }>
    ) {
      const { projectId, tracks } = action.payload;
      tracksAdapter.upsertMany(
        state,
        tracks.map(
          (t): TrackCommittedState => ({
            id: trackEntityId(projectId, t.id),
            projectId,
            trackId: t.id,
            volume: t.gain,
            muted: t.muted ?? false,
            soloed: t.soloed ?? false,
            bus: t.bus,
          })
        )
      );
    },
    trackVolumeCommitted(
      state,
      action: PayloadAction<{ projectId: string; trackId: string; volume: number }>
    ) {
      const { projectId, trackId, volume } = action.payload;
      tracksAdapter.updateOne(state, { id: trackEntityId(projectId, trackId), changes: { volume } });
    },
    trackMuteToggled(state, action: PayloadAction<{ projectId: string; trackId: string }>) {
      const { projectId, trackId } = action.payload;
      const entity = state.entities[trackEntityId(projectId, trackId)];
      if (entity) entity.muted = !entity.muted;
    },
    trackSoloToggled(state, action: PayloadAction<{ projectId: string; trackId: string }>) {
      const { projectId, trackId } = action.payload;
      const entity = state.entities[trackEntityId(projectId, trackId)];
      if (entity) entity.soloed = !entity.soloed;
    },
    /** Drops every committed mixer entry for a project, so deleting one leaves nothing behind. */
    tracksRemovedForProject(state, action: PayloadAction<string>) {
      const stale = Object.values(state.entities)
        .filter((entity) => entity?.projectId === action.payload)
        .map((entity) => entity!.id);
      tracksAdapter.removeMany(state, stale);
    },
    trackBusSet(state, action: PayloadAction<{ projectId: string; trackId: string; bus: Bus }>) {
      const { projectId, trackId, bus } = action.payload;
      tracksAdapter.updateOne(state, { id: trackEntityId(projectId, trackId), changes: { bus } });
    },
  },
});

export const {
  tracksInitializedForProject,
  tracksRemovedForProject,
  trackVolumeCommitted,
  trackMuteToggled,
  trackSoloToggled,
  trackBusSet,
} = tracksSlice.actions;
export const tracksSelectors = tracksAdapter.getSelectors();
export default tracksSlice.reducer;
