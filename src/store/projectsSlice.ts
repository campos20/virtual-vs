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
    /**
     * State-only, like languageOverrideSet - disk persistence is a side
     * effect handled by the persistProjectsReordered thunk
     * (store/persistProjectOrder.ts) that dispatches this, not by callers
     * directly. There's no dedicated adapter method for reordering; setting
     * `ids` directly is RTK's documented way to do it.
     */
    projectsReordered(state, action: PayloadAction<string[]>) {
      state.ids = action.payload;
    },
  },
});

export const {
  projectsHydrated,
  projectAdded,
  projectUpserted,
  projectRemoved,
  projectUpdated,
  projectsReordered,
} = projectsSlice.actions;
export const projectsSelectors = projectsAdapter.getSelectors();
export default projectsSlice.reducer;
