import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MonitorMode } from '@/engine';
import type { Locale } from '@/i18n';
import { readAppSettings } from '@/storage/appSettings';
import { resolveLibraryOrder } from '@/ui/libraryTree';

export interface SettingsState {
  /**
   * Global on purpose: this describes how the headphone splitter is wired at
   * a given gig, not anything about a song. The click toggle, by contrast,
   * is per-project and lives in the project's manifest.
   */
  monitorMode: MonitorMode;
  /** Manually picked on the About screen. `null` means "follow the device locale". */
  languageOverride: Locale | null;
  /**
   * The Library's top-level order, as `folder:`/`project:` keys (see
   * ui/libraryTree.ts). It can't live in projectsSlice's `ids` the way the
   * old project-only order did, because folders aren't projects.
   */
  libraryOrder: string[];
}

const initialState: SettingsState = {
  monitorMode: 'split',
  languageOverride: readAppSettings().languageOverride ?? null,
  libraryOrder: resolveLibraryOrder(readAppSettings()),
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    monitorModeSet(state, action: PayloadAction<MonitorMode>) {
      state.monitorMode = action.payload;
    },
    /**
     * State-only - disk persistence is a side effect and doesn't belong in a
     * reducer, so it's done by the `persistLanguageOverride` thunk
     * (store/persistSettings.ts) that dispatches this, not by callers
     * directly. See persistProject.ts for the same split elsewhere.
     */
    languageOverrideSet(state, action: PayloadAction<Locale | null>) {
      state.languageOverride = action.payload;
    },
    /** State-only, like the above; persisted by the persistLibraryOrder thunk. */
    libraryOrderSet(state, action: PayloadAction<string[]>) {
      state.libraryOrder = action.payload;
    },
  },
});

export const { monitorModeSet, languageOverrideSet, libraryOrderSet } = settingsSlice.actions;
export default settingsSlice.reducer;
