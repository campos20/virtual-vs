import reducer, {
  setlistAdded,
  setlistRemoved,
  setlistUpdated,
  setlistUpserted,
  setlistsSelectors,
  type SetlistEntity,
} from './setlistsSlice';

const initialState = reducer(undefined, { type: '@@INIT' });

function buildEntity(overrides: Partial<SetlistEntity> = {}): SetlistEntity {
  return {
    id: 'set1',
    name: 'Friday Show',
    songs: ['proj1', 'proj2'],
    advance: 'manual',
    padBetween: false,
    ...overrides,
  };
}

describe('setlistsSlice', () => {
  it('adds a setlist', () => {
    const state = reducer(initialState, setlistAdded(buildEntity()));
    expect(setlistsSelectors.selectById(state, 'set1')?.songs).toEqual(['proj1', 'proj2']);
  });

  it('upserts an existing setlist in place', () => {
    const added = reducer(initialState, setlistAdded(buildEntity()));
    const upserted = reducer(added, setlistUpserted(buildEntity({ advance: 'auto' })));
    expect(setlistsSelectors.selectIds(upserted)).toEqual(['set1']);
    expect(setlistsSelectors.selectById(upserted, 'set1')?.advance).toBe('auto');
  });

  it('applies a partial update', () => {
    const added = reducer(initialState, setlistAdded(buildEntity()));
    const updated = reducer(added, setlistUpdated({ id: 'set1', changes: { padBetween: true } }));
    expect(setlistsSelectors.selectById(updated, 'set1')).toMatchObject({
      padBetween: true,
      name: 'Friday Show',
    });
  });

  it('removes a setlist', () => {
    const added = reducer(initialState, setlistAdded(buildEntity()));
    const removed = reducer(added, setlistRemoved('set1'));
    expect(setlistsSelectors.selectIds(removed)).toHaveLength(0);
  });
});
