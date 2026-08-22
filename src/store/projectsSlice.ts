import { createEntityAdapter, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ProjectManifest } from '@/types/project';

/** A project's library entry - its manifest plus where its audio actually lives. */
export interface LibraryProjectEntry extends ProjectManifest {
  origin: 'bundled' | 'filesystem';
  /** `file://` directory URI; only set for `origin: 'filesystem'` projects. */
  sourceDir?: string;
}

const projectsAdapter = createEntityAdapter<LibraryProjectEntry>();

// The Library's display order is deliberately not here. It now covers folders
// as well as projects (see ui/libraryTree.ts), so it can't be this slice's
// `ids` - it lives in settingsSlice's `libraryOrder`.

const projectsSlice = createSlice({
  name: 'projects',
  // `hydrated` distinguishes "no projects on disk" from "haven't looked yet",
  // so the Library can wait instead of flashing its empty state on launch.
  initialState: projectsAdapter.getInitialState({ hydrated: false }),
  reducers: {
    /** Replaces the library with what was just read off disk (plus the bundled demo). */
    projectsHydrated(state, action: PayloadAction<LibraryProjectEntry[]>) {
      projectsAdapter.setAll(state, action.payload);
      state.hydrated = true;
    },
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

export const {
  projectsHydrated,
  projectAdded,
  projectUpserted,
  projectRemoved,
  projectUpdated,
} = projectsSlice.actions;
export const projectsSelectors = projectsAdapter.getSelectors();
export default projectsSlice.reducer;
