import reducer, { clickEnabledSet, monitorModeSet } from './settingsSlice';

describe('settingsSlice', () => {
  it('defaults to split monitor mode with the click enabled', () => {
    const state = reducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({ monitorMode: 'split', clickEnabled: true });
  });

  it('sets the monitor mode', () => {
    const state = reducer(undefined, monitorModeSet('monitor'));
    expect(state.monitorMode).toBe('monitor');
  });

  it('sets whether the click is enabled', () => {
    const state = reducer(undefined, clickEnabledSet(false));
    expect(state.clickEnabled).toBe(false);
  });
});
