import reducer, { languageOverrideSet, monitorModeSet } from './settingsSlice';

describe('settingsSlice', () => {
  it('defaults to split monitor mode and the device locale', () => {
    const state = reducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({ monitorMode: 'split', languageOverride: null });
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
});
