import reducer, { languageOverrideSet, libraryOrderSet, monitorModeSet } from './settingsSlice';

describe('settingsSlice', () => {
  it('defaults to split monitor mode and the device locale', () => {
    const state = reducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({ monitorMode: 'split', languageOverride: null, libraryOrder: [] });
  });

  it('sets the monitor mode', () => {
    const state = reducer(undefined, monitorModeSet('monitor'));
    expect(state.monitorMode).toBe('monitor');
  });

  it('sets and clears the language override', () => {
    const withOverride = reducer(undefined, languageOverrideSet('pt-BR'));
    expect(withOverride.languageOverride).toBe('pt-BR');

    const cleared = reducer(withOverride, languageOverrideSet(null));
    expect(cleared.languageOverride).toBeNull();
  });

  it('replaces the Library order wholesale rather than merging it', () => {
    // The Library hands down a fully-computed order; a merge here would let a
    // stale key the user just deleted survive a reorder.
    const first = reducer(undefined, libraryOrderSet(['folder:a', 'project:b']));
    const second = reducer(first, libraryOrderSet(['project:b']));
    expect(second.libraryOrder).toEqual(['project:b']);
  });
});
