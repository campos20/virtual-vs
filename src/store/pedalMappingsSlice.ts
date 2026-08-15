import { createEntityAdapter, createSlice } from '@reduxjs/toolkit';
import type { PedalMapping } from '@/control/types';

// State only - see src/control/README.md for the BLE-MIDI footswitch TODO
// that will actually populate/consume these mappings.
const pedalMappingsAdapter = createEntityAdapter<PedalMapping>();

const pedalMappingsSlice = createSlice({
  name: 'pedalMappings',
  initialState: pedalMappingsAdapter.getInitialState(),
  reducers: {
    pedalMappingAdded: pedalMappingsAdapter.addOne,
    pedalMappingUpserted: pedalMappingsAdapter.upsertOne,
    pedalMappingRemoved: pedalMappingsAdapter.removeOne,
  },
});

export const { pedalMappingAdded, pedalMappingUpserted, pedalMappingRemoved } = pedalMappingsSlice.actions;
export const pedalMappingsSelectors = pedalMappingsAdapter.getSelectors();
export default pedalMappingsSlice.reducer;
