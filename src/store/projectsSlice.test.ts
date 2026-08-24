import reducer, {
  projectAdded,
  projectRemoved,
  projectUpdated,
  projectUpserted,
  projectsHydrated,
  projectsSelectors,
  type LibraryProjectEntry,
} from './projectsSlice';

const initialState = reducer(undefined, { type: '@@INIT' });

function buildEntry(overrides: Partial<LibraryProjectEntry> = {}): LibraryProjectEntry {
  return {
    id: 'proj1',
    title: 'My Song',
    bpm: 120,
    key: 'C',
    tracks: [],
    sections: [],
    origin: 'filesystem',
    ...overrides,
  };
}

describe('projectsSlice', () => {
  it('adds a project', () => {
    const state = reducer(initialState, projectAdded(buildEntry()));
    expect(projectsSelectors.selectById(state, 'proj1')).toMatchObject({ title: 'My Song' });
  });

  it('upserts an existing project in place', () => {
    const added = reducer(initialState, projectAdded(buildEntry()));
    const upserted = reducer(added, projectUpserted(buildEntry({ title: 'Renamed Set' })));
    expect(projectsSelectors.selectIds(upserted)).toEqual(['proj1']);
    expect(projectsSelectors.selectById(upserted, 'proj1')?.title).toBe('Renamed Set');
  });

  it('applies a partial update', () => {
    const added = reducer(initialState, projectAdded(buildEntry()));
    const updated = reducer(added, projectUpdated({ id: 'proj1', changes: { bpm: 140 } }));
    expect(projectsSelectors.selectById(updated, 'proj1')).toMatchObject({ bpm: 140, title: 'My Song' });
  });

  it('removes a project', () => {
    const added = reducer(initialState, projectAdded(buildEntry()));
    const removed = reducer(added, projectRemoved('proj1'));
    expect(projectsSelectors.selectIds(removed)).toHaveLength(0);
  });

  it('tracks filesystem origin projects with their source directory', () => {
    const entry = buildEntry({ id: 'proj2', origin: 'filesystem', sourceDir: 'file:///projects/proj2' });
    const state = reducer(initialState, projectAdded(entry));
    expect(projectsSelectors.selectById(state, 'proj2')?.sourceDir).toBe('file:///projects/proj2');
  });

  // Was only covered incidentally by the reorder test, which went away with
  // projectsReordered when the Library's order moved to settingsSlice.
  it('replaces the library on hydration and records that the disk was read', () => {
    const hydrated = reducer(
      initialState,
      projectsHydrated([buildEntry({ id: 'a' }), buildEntry({ id: 'b' })])
    );
    expect(projectsSelectors.selectIds(hydrated)).toEqual(['a', 'b']);
    expect(hydrated.hydrated).toBe(true);

    // A second scan replaces rather than merges - a project deleted on disk
    // must not survive in the store.
    const rescanned = reducer(hydrated, projectsHydrated([buildEntry({ id: 'b' })]));
    expect(projectsSelectors.selectIds(rescanned)).toEqual(['b']);
  });
});
