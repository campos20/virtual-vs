import type { TrackManifest } from '@/types/project';
import reducer, {
  trackBusSet,
  trackEntityId,
  trackMuteToggled,
  tracksInitializedForProject,
  tracksSelectors,
  trackSoloToggled,
  trackVolumeCommitted,
  type TrackCommittedState,
} from './tracksSlice';

const initialState = reducer(undefined, { type: '@@INIT' });

const manifestTracks: TrackManifest[] = [
  { id: 'bass', name: 'Bass', file: 'bass.wav', gain: 0.8, bus: 'main' },
  { id: 'click', name: 'Click', file: 'click.wav', gain: 1, bus: 'cue' },
];

describe('tracksSlice', () => {
  it('builds a namespaced entity id from project and track id', () => {
    expect(trackEntityId('proj1', 'bass')).toBe('proj1:bass');
  });

  describe('tracksInitializedForProject', () => {
    it('seeds committed state for every manifest track from its defaults', () => {
      const state = reducer(
        initialState,
        tracksInitializedForProject({ projectId: 'proj1', tracks: manifestTracks })
      );

      const bass = tracksSelectors.selectById(state, 'proj1:bass');
      expect(bass).toEqual<TrackCommittedState>({
        id: 'proj1:bass',
        projectId: 'proj1',
        trackId: 'bass',
        volume: 0.8,
        muted: false,
        soloed: false,
        bus: 'main',
      });
      expect(tracksSelectors.selectIds(state)).toHaveLength(2);
    });

    it('does not clobber already-committed state for a re-opened project', () => {
      const seeded = reducer(
        initialState,
        tracksInitializedForProject({ projectId: 'proj1', tracks: manifestTracks })
      );
      const edited = reducer(
        seeded,
        trackVolumeCommitted({ projectId: 'proj1', trackId: 'bass', volume: 0.2 })
      );

      const reopened = reducer(
        edited,
        tracksInitializedForProject({ projectId: 'proj1', tracks: manifestTracks })
      );

      expect(tracksSelectors.selectById(reopened, 'proj1:bass')?.volume).toBe(0.2);
    });
  });

  it('commits a track volume', () => {
    const seeded = reducer(
      initialState,
      tracksInitializedForProject({ projectId: 'proj1', tracks: manifestTracks })
    );
    const next = reducer(
      seeded,
      trackVolumeCommitted({ projectId: 'proj1', trackId: 'bass', volume: 0.5 })
    );
    expect(tracksSelectors.selectById(next, 'proj1:bass')?.volume).toBe(0.5);
  });

  it('toggles mute independently per track', () => {
    const seeded = reducer(
      initialState,
      tracksInitializedForProject({ projectId: 'proj1', tracks: manifestTracks })
    );
    const muted = reducer(seeded, trackMuteToggled({ projectId: 'proj1', trackId: 'bass' }));
    expect(tracksSelectors.selectById(muted, 'proj1:bass')?.muted).toBe(true);
    expect(tracksSelectors.selectById(muted, 'proj1:click')?.muted).toBe(false);

    const unmuted = reducer(muted, trackMuteToggled({ projectId: 'proj1', trackId: 'bass' }));
    expect(tracksSelectors.selectById(unmuted, 'proj1:bass')?.muted).toBe(false);
  });

  it('toggles solo', () => {
    const seeded = reducer(
      initialState,
      tracksInitializedForProject({ projectId: 'proj1', tracks: manifestTracks })
    );
    const soloed = reducer(seeded, trackSoloToggled({ projectId: 'proj1', trackId: 'bass' }));
    expect(tracksSelectors.selectById(soloed, 'proj1:bass')?.soloed).toBe(true);
  });

  it('sets the routed bus', () => {
    const seeded = reducer(
      initialState,
      tracksInitializedForProject({ projectId: 'proj1', tracks: manifestTracks })
    );
    const next = reducer(seeded, trackBusSet({ projectId: 'proj1', trackId: 'bass', bus: 'both' }));
    expect(tracksSelectors.selectById(next, 'proj1:bass')?.bus).toBe('both');
  });

  it('is a no-op when toggling/committing an unknown track', () => {
    expect(reducer(initialState, trackMuteToggled({ projectId: 'proj1', trackId: 'nope' }))).toEqual(
      initialState
    );
  });
});
