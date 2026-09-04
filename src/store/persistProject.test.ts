import { patchProjectManifest } from '@/storage';
import type { LibraryProjectEntry } from './projectsSlice';
import { createStore } from './index';
import {
  persistProjectClick,
  persistProjectLyrics,
  persistProjectLyricsSync,
  persistProjectMixer,
  persistProjectSections,
} from './persistProject';
import { projectAdded } from './projectsSlice';
import {
  trackBusSet,
  trackMuteToggled,
  trackSoloToggled,
  trackVolumeCommitted,
  tracksInitializedForProject,
} from './tracksSlice';

jest.mock('@/storage', () => ({
  ...jest.requireActual('@/storage'),
  patchProjectManifest: jest.fn(),
}));

const patchMock = patchProjectManifest as jest.Mock;

const project = {
  id: 'song',
  title: 'Song',
  key: '',
  tracks: [
    { id: 'bass', name: 'Bass', file: 'bass.wav', gain: 1, bus: 'main' as const },
    { id: 'keys', name: 'Keys', file: 'keys.wav', gain: 1, bus: 'main' as const },
  ],
  sections: [],
  origin: 'filesystem',
  sourceDir: 'file:///projects/song',
} satisfies LibraryProjectEntry;

function storeWithProject(overrides: Partial<LibraryProjectEntry> = {}) {
  const store = createStore();
  const entry = { ...project, ...overrides };
  store.dispatch(projectAdded(entry));
  store.dispatch(tracksInitializedForProject({ projectId: entry.id, tracks: entry.tracks }));
  return store;
}

beforeEach(() => {
  jest.clearAllMocks();
  patchMock.mockResolvedValue({});
});

describe('persistProjectMixer', () => {
  it('writes committed volume, bus, mute and solo into the manifest', () => {
    const store = storeWithProject();

    store.dispatch(trackVolumeCommitted({ projectId: 'song', trackId: 'bass', volume: 0.42 }));
    store.dispatch(trackBusSet({ projectId: 'song', trackId: 'bass', bus: 'cue' }));
    store.dispatch(trackMuteToggled({ projectId: 'song', trackId: 'bass' }));
    store.dispatch(trackSoloToggled({ projectId: 'song', trackId: 'keys' }));
    store.dispatch(persistProjectMixer('song'));

    const [sourceDir, changes] = patchMock.mock.calls.at(-1)!;
    expect(sourceDir).toBe(project.sourceDir);
    expect(changes.tracks).toEqual([
      expect.objectContaining({ id: 'bass', gain: 0.42, bus: 'cue', muted: true, soloed: false }),
      expect.objectContaining({ id: 'keys', gain: 1, bus: 'main', muted: false, soloed: true }),
    ]);
  });

  it('mirrors the persisted mix back onto the library entry', () => {
    const store = storeWithProject();

    store.dispatch(trackVolumeCommitted({ projectId: 'song', trackId: 'bass', volume: 0.3 }));
    store.dispatch(persistProjectMixer('song'));

    expect(store.getState().projects.entities.song?.tracks[0]).toMatchObject({ gain: 0.3 });
  });

  // Defensive: nothing produces a sourceDir-less entry now that the bundled
  // demo is gone, but the write path still refuses to guess a path.
  it('writes nothing for a project with no source directory', () => {
    const store = storeWithProject({ sourceDir: undefined });

    store.dispatch(persistProjectMixer('song'));

    expect(patchMock).not.toHaveBeenCalled();
  });

  // A failed write must never interrupt playback - the change is already live
  // in the engine and the store.
  it('does not throw when the manifest write fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    patchMock.mockRejectedValue(new Error('disk full'));
    const store = storeWithProject();

    expect(() => store.dispatch(persistProjectMixer('song'))).not.toThrow();
    await Promise.resolve();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('persistProjectClick', () => {
  it('writes the click toggle into the manifest and the entry', () => {
    const store = storeWithProject();

    store.dispatch(persistProjectClick('song', false));

    expect(patchMock).toHaveBeenCalledWith(project.sourceDir, { clickEnabled: false });
    expect(store.getState().projects.entities.song?.clickEnabled).toBe(false);
  });

  it('still updates the entry for a project it cannot write', () => {
    const store = storeWithProject({ sourceDir: undefined });

    store.dispatch(persistProjectClick('song', false));

    expect(patchMock).not.toHaveBeenCalled();
    expect(store.getState().projects.entities.song?.clickEnabled).toBe(false);
  });
});

describe('persistProjectSections', () => {
  it('writes the marker list into the manifest and the entry', () => {
    const store = storeWithProject();
    const sections = [{ id: 'chorus', name: 'Chorus', startSec: 30 }];

    store.dispatch(persistProjectSections('song', sections));

    expect(patchMock).toHaveBeenCalledWith(project.sourceDir, { sections });
    expect(store.getState().projects.entities.song?.sections).toEqual(sections);
  });

  it('still updates the entry for a project it cannot write', () => {
    const store = storeWithProject({ sourceDir: undefined });
    const sections = [{ id: 'chorus', name: 'Chorus', startSec: 30 }];

    store.dispatch(persistProjectSections('song', sections));

    expect(patchMock).not.toHaveBeenCalled();
    expect(store.getState().projects.entities.song?.sections).toEqual(sections);
  });
});

describe('persistProjectLyrics', () => {
  it('writes the lyrics text into the manifest and the entry, clearing sync points', () => {
    const store = storeWithProject();

    store.dispatch(persistProjectLyrics('song', 'La la la\nVerse two'));

    expect(patchMock).toHaveBeenCalledWith(project.sourceDir, {
      lyrics: 'La la la\nVerse two',
      lyricsSyncPoints: [],
    });
    expect(store.getState().projects.entities.song?.lyrics).toBe('La la la\nVerse two');
    expect(store.getState().projects.entities.song?.lyricsSyncPoints).toEqual([]);
  });

  it('still updates the entry for a project it cannot write', () => {
    const store = storeWithProject({ sourceDir: undefined });

    store.dispatch(persistProjectLyrics('song', 'text'));

    expect(patchMock).not.toHaveBeenCalled();
    expect(store.getState().projects.entities.song?.lyrics).toBe('text');
  });
});

describe('persistProjectLyricsSync', () => {
  it('writes the sync points into the manifest and the entry', () => {
    const store = storeWithProject();
    const syncPoints = [{ lineIndex: 2, timeSec: 12.5 }];

    store.dispatch(persistProjectLyricsSync('song', syncPoints));

    expect(patchMock).toHaveBeenCalledWith(project.sourceDir, { lyricsSyncPoints: syncPoints });
    expect(store.getState().projects.entities.song?.lyricsSyncPoints).toEqual(syncPoints);
  });

  it('still updates the entry for a project it cannot write', () => {
    const store = storeWithProject({ sourceDir: undefined });
    const syncPoints = [{ lineIndex: 0, timeSec: 1 }];

    store.dispatch(persistProjectLyricsSync('song', syncPoints));

    expect(patchMock).not.toHaveBeenCalled();
    expect(store.getState().projects.entities.song?.lyricsSyncPoints).toEqual(syncPoints);
  });
});
