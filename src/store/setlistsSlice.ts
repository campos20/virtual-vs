import { createEntityAdapter, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { SetlistManifest } from '@/types/setlist';

/**
 * A setlist *is* a Library folder - see types/setlist.ts. The entity adds
 * nothing to the manifest: the manifest carries its own id, because each one
 * is a file on disk that has to be identifiable on its own.
 *
 * TODO(setlist mode, see src/setlist/README.md): the multi-song controller
 * (advance / pad crossfade) reads `advance` and `padBetween` but isn't
 * implemented yet - as folders, these are inert.
 */
export type SetlistEntity = SetlistManifest;

const setlistsAdapter = createEntityAdapter<SetlistEntity>();

const setlistsSlice = createSlice({
  name: 'setlists',
  // Mirrors projectsSlice: `hydrated` tells "no folders on disk" apart from
  // "haven't read the disk yet", so the Library can wait rather than briefly
  // rendering every song as loose.
  initialState: setlistsAdapter.getInitialState({ hydrated: false }),
  reducers: {
    /** Replaces every folder with what was just read off disk. */
    setlistsHydrated(state, action: PayloadAction<SetlistEntity[]>) {
      setlistsAdapter.setAll(state, action.payload);
      state.hydrated = true;
    },
    setlistAdded: setlistsAdapter.addOne,
    setlistUpserted: setlistsAdapter.upsertOne,
    setlistRemoved: setlistsAdapter.removeOne,
    setlistUpdated(
      state,
      action: PayloadAction<{ id: string; changes: Partial<SetlistEntity> }>
    ) {
      setlistsAdapter.updateOne(state, { id: action.payload.id, changes: action.payload.changes });
    },
  },
});

export const {
  setlistsHydrated,
  setlistAdded,
  setlistUpserted,
  setlistRemoved,
  setlistUpdated,
} = setlistsSlice.actions;
export const setlistsSelectors = setlistsAdapter.getSelectors();
export default setlistsSlice.reducer;
