import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MonitorMode } from '@/engine';
import type { Locale } from '@/i18n';
import { readAppSettings } from '@/storage/appSettings';

export interface SettingsState {
  /**
   * Global on purpose: this describes how the headphone splitter is wired at
   * a given gig, not anything about a song. The click toggle, by contrast,
   * is per-project and lives in the project's manifest.
   */
  monitorMode: MonitorMode;
  /** Manually picked on the About screen. `null` means "follow the device locale". */
  languageOverride: Locale | null;
}

const initialState: SettingsState = {
  monitorMode: 'split',
  languageOverride: readAppSettings().languageOverride ?? null,
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
  },
});

export const { monitorModeSet, languageOverrideSet } = settingsSlice.actions;
export default settingsSlice.reducer;
