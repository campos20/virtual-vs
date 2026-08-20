import { audioEngine } from '@/engine';
import { decodeProjectAudio, getProjectSourceForEntry } from '@/storage';
import type { LibraryProjectEntry } from '@/store/projectsSlice';
import { nowPlayingStore } from './nowPlayingStore';

jest.mock('@/storage', () => ({
  ...jest.requireActual('@/storage'),
  getProjectSourceForEntry: jest.fn(),
  decodeProjectAudio: jest.fn(),
}));

const getSourceMock = getProjectSourceForEntry as jest.Mock;
const decodeMock = decodeProjectAudio as jest.Mock;

const ENGINE_OPTIONS = { monitorMode: 'split' as const, clickEnabled: true };

function entry(id: string, overrides: Partial<LibraryProjectEntry> = {}): LibraryProjectEntry {
  return {
    id,
    title: id,
    key: '',
    tracks: [{ id: 'a', name: 'A', file: 'a.wav', gain: 1, bus: 'main' }],
    sections: [],
    origin: 'filesystem',
    sourceDir: `file:///mock/${id}`,
    ...overrides,
  };
}

// jest.spyOn on an already-spied method returns the same spy instead of
// re-wrapping it, so a spy left over from a previous test would otherwise
// carry that test's call history into this one - restore real
// implementations between tests instead of only clearing call history.
afterEach(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  nowPlayingStore.resetForTests();
  getSourceMock.mockImplementation(async (e: LibraryProjectEntry) => ({
    manifest: e,
    resolveFile: () => 0,
  }));
  decodeMock.mockImplementation(async (_ctx, source) => ({
    manifest: source.manifest,
    trackBuffers: {},
  }));
});

describe('nowPlayingStore', () => {
  it('decodes and loads a project on first open', async () => {
    const loadSpy = jest.spyOn(audioEngine, 'loadProject');

    const result = await nowPlayingStore.openProject(entry('a'), ENGINE_OPTIONS);

    expect(loadSpy).toHaveBeenCalled();
    expect(result.manifest.id).toBe('a');
    expect(nowPlayingStore.getSnapshot().projectId).toBe('a');
  });

  it('is a no-op that leaves playback untouched when re-opening the same project', async () => {
    await nowPlayingStore.openProject(entry('a'), ENGINE_OPTIONS);
    audioEngine.play();
    const loadSpy = jest.spyOn(audioEngine, 'loadProject');

    await nowPlayingStore.openProject(entry('a'), ENGINE_OPTIONS);

    expect(loadSpy).not.toHaveBeenCalled();
    expect(audioEngine.getTransportState()).toBe('playing');
    audioEngine.stop();
  });

  it('reload forces a fresh decode even for the already-current project', async () => {
    await nowPlayingStore.openProject(entry('a'), ENGINE_OPTIONS);
    const loadSpy = jest.spyOn(audioEngine, 'loadProject');

    await nowPlayingStore.reload(entry('a'), ENGINE_OPTIONS);

    expect(loadSpy).toHaveBeenCalled();
  });

  it('does not clobber an already-loaded project when a different project fails to load', async () => {
    await nowPlayingStore.openProject(entry('a'), ENGINE_OPTIONS);
    getSourceMock.mockRejectedValueOnce(new Error('missing manifest'));

    await expect(nowPlayingStore.openProject(entry('b'), ENGINE_OPTIONS)).rejects.toThrow(
      'missing manifest'
    );

    expect(nowPlayingStore.getSnapshot().projectId).toBe('a');
  });

  it('never commits a slow, superseded load over a newer one', async () => {
    let resolveB!: () => void;
    decodeMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveB = () => resolve({ manifest: entry('b'), trackBuffers: {} });
        })
    );
    const openB = nowPlayingStore.openProject(entry('b'), ENGINE_OPTIONS).catch((e) => e);

    // A second, later request for a different project completes first.
    await nowPlayingStore.openProject(entry('c'), ENGINE_OPTIONS);
    expect(nowPlayingStore.getSnapshot().projectId).toBe('c');

    resolveB();
    const resultB = await openB;
    expect(resultB).toBeInstanceOf(Error);
    expect(nowPlayingStore.getSnapshot().projectId).toBe('c');
  });

  it('closeIfCurrent stops and clears only when it matches the loaded project', async () => {
    await nowPlayingStore.openProject(entry('a'), ENGINE_OPTIONS);
    audioEngine.play();
    const stopSpy = jest.spyOn(audioEngine, 'stop');

    nowPlayingStore.closeIfCurrent('someone-else');
    expect(stopSpy).not.toHaveBeenCalled();
    expect(nowPlayingStore.getSnapshot().projectId).toBe('a');

    nowPlayingStore.closeIfCurrent('a');
    expect(stopSpy).toHaveBeenCalled();
    expect(nowPlayingStore.getSnapshot().projectId).toBeNull();
  });

  it('renameTrackLocal patches both the manifest and the waveform tracks', async () => {
    await nowPlayingStore.openProject(entry('a'), ENGINE_OPTIONS);

    nowPlayingStore.renameTrackLocal('a', 'Renamed');

    const snapshot = nowPlayingStore.getSnapshot();
    expect(snapshot.manifest?.tracks.find((t) => t.id === 'a')?.name).toBe('Renamed');
    expect(snapshot.waveformTracks.find((t) => t.id === 'a')?.name).toBe('Renamed');
  });

  it('renameTrackLocal is a no-op when nothing is loaded', () => {
    expect(() => nowPlayingStore.renameTrackLocal('a', 'Renamed')).not.toThrow();
    expect(nowPlayingStore.getSnapshot().projectId).toBeNull();
  });

  it('notifies subscribers on commit', async () => {
    const listener = jest.fn();
    const unsubscribe = nowPlayingStore.subscribe(listener);

    await nowPlayingStore.openProject(entry('a'), ENGINE_OPTIONS);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    nowPlayingStore.closeIfCurrent('a');
    expect(listener).not.toHaveBeenCalled();
  });
});
