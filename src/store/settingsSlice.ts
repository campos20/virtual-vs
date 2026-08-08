import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MonitorMode } from '@/engine';

export interface SettingsState {
  monitorMode: MonitorMode;
  clickEnabled: boolean;
}

const initialState: SettingsState = {
  monitorMode: 'split',
  clickEnabled: true,
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    monitorModeSet(state, action: PayloadAction<MonitorMode>) {
      state.monitorMode = action.payload;
    },
    clickEnabledSet(state, action: PayloadAction<boolean>) {
      state.clickEnabled = action.payload;
    },
  },
});

export const { monitorModeSet, clickEnabledSet } = settingsSlice.actions;
export default settingsSlice.reducer;
