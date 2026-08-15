import type { TrackManifest } from '@/types/project';
import { trackRuntimeStatesFromManifest } from './trackRuntimeState';

function track(overrides: Partial<TrackManifest> = {}): TrackManifest {
  return { id: 'bass', name: 'Bass', file: 'bass.wav', gain: 1, bus: 'main', ...overrides };
}

describe('trackRuntimeStatesFromManifest', () => {
  // This is what carries a soundchecked mix into the engine on load; if it
  // silently dropped mute/solo the mixer would look right while the audio was
  // wrong, which is the worst possible failure on stage.
  it('carries committed volume, bus, mute and solo through to the engine', () => {
    const states = trackRuntimeStatesFromManifest([
      track({ id: 'bass', gain: 0.42, bus: 'cue', muted: true, soloed: false }),
      track({ id: 'keys', gain: 0.9, bus: 'both', muted: false, soloed: true }),
    ]);

    expect(states.bass).toEqual({
      id: 'bass',
      volume: 0.42,
      bus: 'cue',
      muted: true,
      soloed: false,
    });
    expect(states.keys).toEqual({
      id: 'keys',
      volume: 0.9,
      bus: 'both',
      muted: false,
      soloed: true,
    });
  });

  // Projects created before mute/solo were persisted have neither field.
  it('treats absent mute/solo as off', () => {
    const states = trackRuntimeStatesFromManifest([track()]);

    expect(states.bass.muted).toBe(false);
    expect(states.bass.soloed).toBe(false);
  });

  it('returns nothing for a project with no stems', () => {
    expect(trackRuntimeStatesFromManifest([])).toEqual({});
  });
});
