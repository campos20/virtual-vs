import type { PedalMapping } from '@/control/types';
import reducer, {
  pedalMappingAdded,
  pedalMappingRemoved,
  pedalMappingUpserted,
  pedalMappingsSelectors,
} from './pedalMappingsSlice';

const initialState = reducer(undefined, { type: '@@INIT' });

function buildMapping(overrides: Partial<PedalMapping> = {}): PedalMapping {
  return { id: 'pedal1', midiNote: 60, action: 'playPause', label: 'Play/Pause', ...overrides };
}

describe('pedalMappingsSlice', () => {
  it('adds a mapping', () => {
    const state = reducer(initialState, pedalMappingAdded(buildMapping()));
    expect(pedalMappingsSelectors.selectById(state, 'pedal1')).toMatchObject({ action: 'playPause' });
  });

  it('upserts an existing mapping in place', () => {
    const added = reducer(initialState, pedalMappingAdded(buildMapping()));
    const upserted = reducer(added, pedalMappingUpserted(buildMapping({ action: 'nextSection' })));
    expect(pedalMappingsSelectors.selectIds(upserted)).toEqual(['pedal1']);
    expect(pedalMappingsSelectors.selectById(upserted, 'pedal1')?.action).toBe('nextSection');
  });

  it('removes a mapping', () => {
    const added = reducer(initialState, pedalMappingAdded(buildMapping()));
    const removed = reducer(added, pedalMappingRemoved('pedal1'));
    expect(pedalMappingsSelectors.selectIds(removed)).toHaveLength(0);
  });
});
