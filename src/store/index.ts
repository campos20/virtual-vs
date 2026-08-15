import { configureStore } from '@reduxjs/toolkit';
import pedalMappingsReducer from './pedalMappingsSlice';
import projectsReducer from './projectsSlice';
import setlistsReducer from './setlistsSlice';
import settingsReducer from './settingsSlice';
import tracksReducer from './tracksSlice';

// No RTK Query: there's no backend, everything here is local device state.
export function createStore() {
  return configureStore({
    reducer: {
      projects: projectsReducer,
      setlists: setlistsReducer,
      settings: settingsReducer,
      pedalMappings: pedalMappingsReducer,
      tracks: tracksReducer,
    },
  });
}

export const store = createStore();

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
