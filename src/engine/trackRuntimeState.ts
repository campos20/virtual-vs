import type { TrackManifest } from '@/types/project';
import type { TrackRuntimeState } from './types';

/**
 * Builds the engine's starting mixer state for a project straight from its
 * manifest.
 *
 * The manifest is the source of truth for committed volume/bus/mute/solo (see
 * storage/importProject.ts), so this needs no access to the Redux store - the
 * store is seeded from exactly the same data at load time.
 */
export function trackRuntimeStatesFromManifest(
  tracks: TrackManifest[]
): Record<string, TrackRuntimeState> {
  const states: Record<string, TrackRuntimeState> = {};
  for (const track of tracks) {
    states[track.id] = {
      id: track.id,
      bus: track.bus,
      volume: track.gain,
      muted: track.muted ?? false,
      soloed: track.soloed ?? false,
    };
  }
  return states;
}
