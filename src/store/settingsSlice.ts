import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MonitorMode } from '@/engine';

export interface SettingsState {
  /**
   * Global on purpose: this describes how the headphone splitter is wired at
   * a given gig, not anything about a song. The click toggle, by contrast,
   * is per-project and lives in the project's manifest.
   */
  monitorMode: MonitorMode;
}

const initialState: SettingsState = {
  monitorMode: 'split',
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    monitorModeSet(state, action: PayloadAction<MonitorMode>) {
      state.monitorMode = action.payload;
    },
  },
});

export const { monitorModeSet } = settingsSlice.actions;
export default settingsSlice.reducer;
