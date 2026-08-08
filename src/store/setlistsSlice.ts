import { createEntityAdapter, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { SetlistManifest } from '@/types/setlist';

// TODO(setlist mode, see src/setlist/README.md): this slice only persists
// setlist data today. The multi-song controller (advance/pad crossfade)
// reads it but isn't implemented yet.
export interface SetlistEntity extends SetlistManifest {
  id: string;
}

const setlistsAdapter = createEntityAdapter<SetlistEntity>();

const setlistsSlice = createSlice({
  name: 'setlists',
  initialState: setlistsAdapter.getInitialState(),
  reducers: {
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

export const { setlistAdded, setlistUpserted, setlistRemoved, setlistUpdated } = setlistsSlice.actions;
export const setlistsSelectors = setlistsAdapter.getSelectors();
export default setlistsSlice.reducer;
