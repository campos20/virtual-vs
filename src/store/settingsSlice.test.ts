import reducer, { monitorModeSet } from './settingsSlice';

describe('settingsSlice', () => {
  it('defaults to split monitor mode', () => {
    const state = reducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({ monitorMode: 'split' });
  });

  it('sets the monitor mode', () => {
    const state = reducer(undefined, monitorModeSet('monitor'));
    expect(state.monitorMode).toBe('monitor');
  });
});
