import { createEntityAdapter, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ProjectManifest } from '@/types/project';

/** A project's library entry - its manifest plus where its audio actually lives. */
export interface LibraryProjectEntry extends ProjectManifest {
  origin: 'bundled' | 'filesystem';
  /** `file://` directory URI; only set for `origin: 'filesystem'` projects. */
  sourceDir?: string;
}

const projectsAdapter = createEntityAdapter<LibraryProjectEntry>();

const projectsSlice = createSlice({
  name: 'projects',
  initialState: projectsAdapter.getInitialState(),
  reducers: {
    projectAdded: projectsAdapter.addOne,
    projectUpserted: projectsAdapter.upsertOne,
    projectRemoved: projectsAdapter.removeOne,
    projectUpdated(
      state,
      action: PayloadAction<{ id: string; changes: Partial<LibraryProjectEntry> }>
    ) {
      projectsAdapter.updateOne(state, { id: action.payload.id, changes: action.payload.changes });
    },
  },
});

export const { projectAdded, projectUpserted, projectRemoved, projectUpdated } = projectsSlice.actions;
export const projectsSelectors = projectsAdapter.getSelectors();
export default projectsSlice.reducer;
