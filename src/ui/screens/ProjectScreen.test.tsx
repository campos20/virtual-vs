import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { getDocumentAsync } from 'expo-document-picker';
import { audioEngine } from '@/engine';
import {
  addStemsToProject,
  deleteProjectDirectory,
  getProjectSourceForEntry,
  patchProjectManifest,
  removeStemFromProject,
  renameStemInProject,
  updateProjectMetadata,
} from '@/storage';
import { nowPlayingStore } from '@/playback/nowPlayingStore';
import { createStore } from '@/store';
import { projectAdded, type LibraryProjectEntry } from '@/store/projectsSlice';
import { trackEntityId, tracksInitializedForProject } from '@/store/tracksSlice';
import { renderWithStore } from '@/test-utils/renderWithStore';
import { ProjectScreen } from './ProjectScreen';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: { projectId?: string } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
}));

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

jest.mock('@/storage', () => ({
  ...jest.requireActual('@/storage'),
  updateProjectMetadata: jest.fn(),
  addStemsToProject: jest.fn(),
  removeStemFromProject: jest.fn(),
  renameStemInProject: jest.fn(),
  deleteProjectDirectory: jest.fn(),
  getProjectSourceForEntry: jest.fn(),
  patchProjectManifest: jest.fn(),
}));

const patchManifestMock = patchProjectManifest as jest.Mock;

const pickerMock = getDocumentAsync as jest.Mock;

// usePlayhead's requestAnimationFrame loop ticks independently of React's act()
// batching, which trips act() warnings once it outlives the test that started
// it. No test here asserts on the live-ticking readout, so never schedule.
beforeEach(() => {
  jest.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(0);
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  // nowPlayingStore's whole point is skipping a reload when a project is
  // already current - which would silently leak across tests that reuse the
  // same project id (most of them use 'sync-test') unless reset here.
  nowPlayingStore.resetForTests();
  // Real behaviour by default; individual tests override it.
  (getProjectSourceForEntry as jest.Mock).mockImplementation(
    jest.requireActual('@/storage').getProjectSourceForEntry
  );
  patchManifestMock.mockResolvedValue({});
});

function asset(name: string, uri: string) {
  return { name, uri, size: 1, mimeType: 'audio/wav', lastModified: 0 };
}

const filesystemProject = {
  id: 'my-song',
  title: 'My Song',
  bpm: 100,
  key: 'C',
  tracks: [
    { id: 'bass', name: 'Bass', file: 'bass.wav', gain: 1, bus: 'main' as const },
    { id: 'keys', name: 'Keys', file: 'keys.wav', gain: 1, bus: 'main' as const },
  ],
  sections: [],
  origin: 'filesystem' as const,
  sourceDir: 'file:///mock/document/projects/my-song',
};

/**
 * Three stems with one routed to cue and a bpm so there's a click - the shape
 * the bundled demo project provided before it was removed. Unlike
 * `filesystemProject` above, tests using this stub `getProjectSourceForEntry`,
 * so the load actually succeeds and the mixer renders.
 */
const threeStemProject: LibraryProjectEntry = {
  id: 'sync-test',
  title: 'Sync Test',
  bpm: 120,
  key: 'A minor',
  tracks: [
    { id: 'bass', name: 'Bass', file: 'bass.wav', gain: 0.85, bus: 'main' },
    { id: 'keys', name: 'Keys', file: 'keys.wav', gain: 0.85, bus: 'main' },
    { id: 'guide', name: 'Guide Vocal', file: 'guide.wav', gain: 0.9, bus: 'cue' },
  ],
  sections: [],
  origin: 'filesystem',
  sourceDir: 'file:///mock/document/projects/sync-test',
};

function renderLoaded(manifest: LibraryProjectEntry = threeStemProject) {
  (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
    manifest,
    // The audio mock decodes any ref, so the stems never have to exist.
    resolveFile: () => 0,
  });
  mockParams = { projectId: threeStemProject.id };
  const store = createStore();
  store.dispatch(projectAdded(threeStemProject));
  return renderWithStore(<ProjectScreen />, store);
}

async function waitForMixer() {
  await waitFor(() => expect(screen.getByTestId('mixer-menu-button')).toBeTruthy());
}

/** Volume/output/click controls live behind the hamburger drawer now - open it before touching them. */
function openMixer() {
  fireEvent.press(screen.getByTestId('mixer-menu-button'));
}

describe('ProjectScreen - playing', () => {
  it('loads a project and renders a channel strip per track', async () => {
    renderLoaded();
    await waitForMixer();

    expect(screen.getByText('Sync Test')).toBeTruthy();
    expect(screen.getByText('120 BPM')).toBeTruthy();
    // The waveform view labels each stem's lane too, so "Keys" is already on screen.
    expect(screen.getByText('Keys')).toBeTruthy();

    openMixer();
    // Now it appears twice: once for its waveform lane, once for its channel strip.
    expect(screen.getAllByText('Keys')).toHaveLength(2);
    expect(screen.getAllByText('Guide Vocal')).toHaveLength(2);
  });

  // Play/pause/stop/seek are exclusively the global NowPlayingBar's job now
  // (see NowPlayingBar.test.tsx) - this screen only loads a project in and
  // lets the shared engine transport drive its waveform.
  it('loads the project into the engine, ready to play', async () => {
    renderLoaded();
    await waitForMixer();

    expect(audioEngine.getManifestTrackIds().length).toBeGreaterThan(0);
    audioEngine.play();
    expect(audioEngine.getTransportState()).toBe('playing');
    audioEngine.stop();
  });

  it('toggling mute commits to the engine and the store', async () => {
    const { store } = renderLoaded();
    await waitForMixer();
    openMixer();

    const [bassMute] = screen.getAllByText('M');
    fireEvent.press(bassMute);

    expect(audioEngine.getTrackState('bass')?.muted).toBe(true);
    expect(
      store.getState().tracks.entities[trackEntityId('sync-test', 'bass')]?.muted
    ).toBe(true);
  });

  // Guards the wiring a module-level `store.getState()` used to hide. Mute and
  // solo are the tell: AudioEngine's fallback for a track it wasn't given
  // state for hardcodes them off, so a screen that fails to pass the manifest
  // mix through would show a muted channel while playing it at full level.
  it('seeds the engine with the mix stored in the project manifest', async () => {
    renderLoaded({
      ...threeStemProject,
      tracks: threeStemProject.tracks.map((track) =>
        track.id === 'bass'
          ? { ...track, gain: 0.25, bus: 'both' as const, muted: true }
          : track.id === 'keys'
            ? { ...track, soloed: true }
            : track
      ),
    });
    await waitForMixer();

    expect(audioEngine.getTrackState('bass')?.muted).toBe(true);
    expect(audioEngine.getTrackState('bass')?.volume).toBeCloseTo(0.25, 5);
    expect(audioEngine.getTrackState('bass')?.bus).toBe('both');
    expect(audioEngine.getTrackState('keys')?.soloed).toBe(true);
  });

  // The core of the "now playing" feature: playback used to be tied to this
  // screen's mount lifecycle (stopped on Back/unmount/entering Edit) - it no
  // longer is. Only the mini-player, deleting the project, or the user
  // explicitly hitting stop/pause should ever stop the engine now.
  it('keeps playing across unmount, instead of stopping like it used to', async () => {
    const stopSpy = jest.spyOn(audioEngine, 'stop');

    const { unmount } = renderLoaded();
    await waitForMixer();
    audioEngine.play();
    stopSpy.mockClear();

    unmount();

    expect(stopSpy).not.toHaveBeenCalled();
    expect(audioEngine.getTransportState()).toBe('playing');
    audioEngine.stop();
  });

  it('does not re-decode or restart playback when re-opening the same project', async () => {
    const { unmount } = renderLoaded();
    await waitForMixer();
    audioEngine.play();
    unmount();

    (getProjectSourceForEntry as jest.Mock).mockClear();
    renderLoaded();
    await waitForMixer();

    expect(getProjectSourceForEntry).not.toHaveBeenCalled();
    expect(audioEngine.getTransportState()).toBe('playing');
    audioEngine.stop();
  });

  // "Stop A, show B" - opening a *different* project is the one case that's
  // still supposed to interrupt whatever was playing (unlike Back/Edit/
  // re-opening the same project, which no longer do).
  it('opening a different project stops the previous one and replaces it', async () => {
    const { unmount } = renderLoaded();
    await waitForMixer();
    audioEngine.play();
    unmount();

    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: filesystemProject,
      resolveFile: () => 0,
    });
    mockParams = { projectId: 'my-song' };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    renderWithStore(<ProjectScreen />, store);
    await waitForMixer();

    expect(audioEngine.getTransportState()).toBe('stopped');
    expect(screen.getByText('My Song')).toBeTruthy();
  });
});

describe('ProjectScreen - markers', () => {
  function openMarkers() {
    fireEvent.press(screen.getByTestId('markers-menu-button'));
  }

  it('adds a marker at the current position from a preset chip', async () => {
    renderLoaded();
    await waitForMixer();
    openMarkers();

    fireEvent.press(screen.getByTestId('marker-preset-presetChorus'));
    fireEvent.press(screen.getByTestId('add-marker-button'));

    // The row is numbered ("1. Chorus"), distinct from the preset chip's plain "Chorus".
    expect(screen.getByText('1. Chorus')).toBeTruthy();
    const [sourceDir, changes] = patchManifestMock.mock.calls.at(-1)!;
    expect(sourceDir).toBe(threeStemProject.sourceDir);
    expect(changes.sections).toEqual([
      expect.objectContaining({ name: 'Chorus', startSec: expect.any(Number) }),
    ]);
  });

  it('does not add a marker with an empty name', async () => {
    renderLoaded();
    await waitForMixer();
    openMarkers();

    fireEvent.press(screen.getByTestId('add-marker-button'));

    expect(patchManifestMock).not.toHaveBeenCalled();
  });

  it('jumps to a marker and closes the drawer', async () => {
    const seekSpy = jest.spyOn(audioEngine, 'seek');
    renderLoaded({
      ...threeStemProject,
      sections: [{ id: 'chorus', name: 'Chorus', startSec: 42 }],
    });
    await waitForMixer();
    openMarkers();

    fireEvent.press(screen.getByTestId('jump-marker-chorus'));

    expect(seekSpy).toHaveBeenCalledWith(42);
    expect(screen.queryByTestId('close-markers-button')).toBeNull();
  });

  it('removes a marker', async () => {
    renderLoaded({
      ...threeStemProject,
      sections: [{ id: 'chorus', name: 'Chorus', startSec: 42 }],
    });
    await waitForMixer();
    openMarkers();

    fireEvent.press(screen.getByTestId('remove-marker-chorus'));

    expect(screen.queryByTestId('jump-marker-chorus')).toBeNull();
    const [sourceDir, changes] = patchManifestMock.mock.calls.at(-1)!;
    expect(sourceDir).toBe(threeStemProject.sourceDir);
    expect(changes.sections).toEqual([]);
  });
});

describe('ProjectScreen - lyrics', () => {
  function toggleLyrics() {
    fireEvent.press(screen.getByTestId('lyrics-toggle-button'));
  }

  it('swaps the waveform for the lyrics view and back', async () => {
    renderLoaded();
    await waitForMixer();

    expect(screen.getByText('Bass')).toBeTruthy();
    expect(screen.queryByTestId('edit-lyrics-button')).toBeNull();

    toggleLyrics();

    expect(screen.queryByText('Bass')).toBeNull();
    expect(screen.getByTestId('edit-lyrics-button')).toBeTruthy();

    toggleLyrics();

    expect(screen.getByText('Bass')).toBeTruthy();
    expect(screen.queryByTestId('edit-lyrics-button')).toBeNull();
  });

  it('collapses the BPM/Key header pills while viewing lyrics', async () => {
    renderLoaded();
    await waitForMixer();
    expect(screen.getByText('120 BPM')).toBeTruthy();

    toggleLyrics();

    expect(screen.queryByText('120 BPM')).toBeNull();
  });

  it('saves lyrics entered through the drawer', async () => {
    renderLoaded();
    await waitForMixer();
    toggleLyrics();

    fireEvent.press(screen.getByTestId('add-lyrics-button'));
    fireEvent.changeText(screen.getByTestId('lyrics-input'), 'Line one\nLine two');
    fireEvent.press(screen.getByTestId('save-lyrics-button'));

    expect(patchManifestMock).toHaveBeenCalledWith(threeStemProject.sourceDir, {
      lyrics: 'Line one\nLine two',
      lyricsSyncPoints: [],
    });
    expect(screen.getByText('Line one')).toBeTruthy();
  });

  it('tapping a line persists a sync point at the precise playhead', async () => {
    renderLoaded({ ...threeStemProject, lyrics: 'Line one\nLine two' });
    await waitForMixer();
    toggleLyrics();

    fireEvent.press(screen.getByTestId('lyrics-line-1'));

    expect(patchManifestMock).toHaveBeenCalledWith(threeStemProject.sourceDir, {
      lyricsSyncPoints: [{ lineIndex: 1, timeSec: expect.any(Number) }],
    });
  });

  // Neither lyrics text nor a line tap ever touches the audio graph, so
  // unlike bpm/key edits (gated via transportIsRunning()), both should work
  // mid-song - same reasoning as markers ("still allows renaming a stem
  // while playing" above).
  it('does not block lyrics editing or line-tapping while the transport is playing', async () => {
    renderLoaded({ ...threeStemProject, lyrics: 'Line one\nLine two' });
    await waitForMixer();
    toggleLyrics();
    audioEngine.play();

    fireEvent.press(screen.getByTestId('lyrics-line-0'));
    fireEvent.press(screen.getByTestId('edit-lyrics-button'));
    fireEvent.changeText(screen.getByTestId('lyrics-input'), 'Edited live');
    fireEvent.press(screen.getByTestId('save-lyrics-button'));

    expect(patchManifestMock).toHaveBeenCalledWith(threeStemProject.sourceDir, {
      lyricsSyncPoints: [{ lineIndex: 0, timeSec: expect.any(Number) }],
    });
    expect(patchManifestMock).toHaveBeenCalledWith(threeStemProject.sourceDir, {
      lyrics: 'Edited live',
      lyricsSyncPoints: [],
    });
    expect(audioEngine.getTransportState()).toBe('playing');
    audioEngine.stop();
  });
});

describe('ProjectScreen - editing in place', () => {
  function renderEditable() {
    mockParams = { projectId: 'my-song' };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    return renderWithStore(<ProjectScreen />, store);
  }

  // Edit lives behind the mixer drawer now, not in the main header, so a
  // stray tap during a set can't land on it - it takes opening the mixer first.
  it('keeps Edit out of the header and reachable only through the mixer once loaded', async () => {
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: filesystemProject,
      resolveFile: () => 0,
    });

    renderEditable();
    await waitForMixer();
    expect(screen.queryByTestId('edit-button')).toBeNull();

    openMixer();
    expect(screen.getByTestId('edit-button')).toBeTruthy();
  });

  // A failed load (e.g. a corrupted stem) is exactly when the user needs to
  // get into the editor to fix it, so Edit can't be trapped behind a mixer
  // drawer that has nothing to show - it has to surface directly.
  it('offers Edit directly, without a mixer, when the project fails to load', async () => {
    renderEditable(); // the default mocked getProjectSourceForEntry fails for this fake sourceDir
    await waitFor(() => expect(screen.getByTestId('edit-button')).toBeTruthy());

    expect(screen.getByText(filesystemProject.title)).toBeTruthy();
    expect(screen.queryByTestId('mixer-menu-button')).toBeNull();
  });

  // Entering Edit used to always stop audio first - it no longer does, so a
  // song keeps playing while its stems are being tidied up mid-set.
  it('swaps in the form without stopping playback when Edit is pressed', async () => {
    renderEditable();
    await waitFor(() => expect(screen.getByTestId('edit-button')).toBeTruthy());
    const stopSpy = jest.spyOn(audioEngine, 'stop');

    fireEvent.press(screen.getByTestId('edit-button'));

    expect(stopSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('title-input')).toBeTruthy();
    expect(screen.getByTestId('save-button')).toBeTruthy();
  });

  it('saves edited metadata and returns to the mixer', async () => {
    (updateProjectMetadata as jest.Mock).mockResolvedValue({});
    const { store } = renderEditable();
    await waitFor(() => expect(screen.getByTestId('edit-button')).toBeTruthy());

    fireEvent.press(screen.getByTestId('edit-button'));
    fireEvent.changeText(screen.getByTestId('title-input'), 'Renamed');
    fireEvent.press(screen.getByTestId('save-button'));

    await waitFor(() =>
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        filesystemProject.sourceDir,
        expect.objectContaining({ title: 'Renamed', bpm: 100 })
      )
    );
    await waitFor(() =>
      expect(store.getState().projects.entities['my-song']?.title).toBe('Renamed')
    );
    await waitFor(() => expect(screen.queryByTestId('title-input')).toBeNull());
  });

  it('clearing the tempo saves an undefined bpm, removing the click', async () => {
    (updateProjectMetadata as jest.Mock).mockResolvedValue({});
    renderEditable();
    await waitFor(() => expect(screen.getByTestId('edit-button')).toBeTruthy());

    fireEvent.press(screen.getByTestId('edit-button'));
    fireEvent.changeText(screen.getByTestId('bpm-input'), '');
    fireEvent.press(screen.getByTestId('save-button'));

    await waitFor(() =>
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        filesystemProject.sourceDir,
        expect.objectContaining({ bpm: undefined })
      )
    );
  });

  // A cloud-picked file can take many seconds to copy, convert and decode.
  // Without this the screen just sat there blank, so the phase label is the
  // whole point of the feature - assert the user actually sees it.
  it('shows what the import is doing while it runs', async () => {
    pickerMock.mockResolvedValue({
      canceled: false,
      assets: [asset('gtr.wav', 'file:///tmp/gtr.wav')],
    });

    let finishImport: () => void = () => {};
    const importDone = new Promise<void>((resolve) => {
      finishImport = resolve;
    });
    (addStemsToProject as jest.Mock).mockImplementation(
      async (_dir: string, _files: unknown, _ctx: unknown, onProgress?: (u: unknown) => void) => {
        onProgress?.({ phase: 'copying', name: 'gtr.wav' });
        await importDone;
        return { ...filesystemProject, tracks: filesystemProject.tracks };
      }
    );

    renderEditable();
    await waitFor(() => expect(screen.getByTestId('edit-button')).toBeTruthy());
    fireEvent.press(screen.getByTestId('edit-button'));
    fireEvent.press(screen.getByTestId('pick-files-button'));

    await waitFor(() => expect(screen.getByTestId('import-status')).toBeTruthy());
    expect(screen.getByText('Copying gtr.wav…')).toBeTruthy();

    finishImport();
    await waitFor(() => expect(screen.queryByText('Copying gtr.wav…')).toBeNull());
  });

  it('adds stems through to the project folder', async () => {
    (addStemsToProject as jest.Mock).mockResolvedValue({
      ...filesystemProject,
      tracks: [
        ...filesystemProject.tracks,
        { id: 'gtr', name: 'Gtr', file: 'gtr.wav', gain: 1, bus: 'main' as const },
      ],
    });
    pickerMock.mockResolvedValue({
      canceled: false,
      assets: [asset('gtr.wav', 'file:///tmp/gtr.wav')],
    });

    const { store } = renderEditable();
    await waitFor(() => expect(screen.getByTestId('edit-button')).toBeTruthy());
    fireEvent.press(screen.getByTestId('edit-button'));
    fireEvent.press(screen.getByTestId('pick-files-button'));

    await waitFor(() => expect(addStemsToProject).toHaveBeenCalled());
    await waitFor(() =>
      expect(store.getState().projects.entities['my-song']?.tracks).toHaveLength(3)
    );
  });

  it('removes a stem through to the project folder', async () => {
    (removeStemFromProject as jest.Mock).mockResolvedValue({
      ...filesystemProject,
      tracks: filesystemProject.tracks.filter((t) => t.id !== 'bass'),
    });

    const { store } = renderEditable();
    await waitFor(() => expect(screen.getByTestId('edit-button')).toBeTruthy());
    fireEvent.press(screen.getByTestId('edit-button'));
    fireEvent.press(screen.getByTestId('remove-stem-bass'));

    await waitFor(() =>
      expect(removeStemFromProject).toHaveBeenCalledWith(filesystemProject.sourceDir, 'bass')
    );
    await waitFor(() =>
      expect(store.getState().projects.entities['my-song']?.tracks).toHaveLength(1)
    );
  });

  it('renames a stem through to the project folder on blur, not on every keystroke', async () => {
    (renameStemInProject as jest.Mock).mockResolvedValue({
      ...filesystemProject,
      tracks: filesystemProject.tracks.map((t) =>
        t.id === 'bass' ? { ...t, name: 'Low End' } : t
      ),
    });

    const { store } = renderEditable();
    await waitFor(() => expect(screen.getByTestId('edit-button')).toBeTruthy());
    fireEvent.press(screen.getByTestId('edit-button'));

    const bassNameInput = screen.getByTestId('rename-stem-bass');
    fireEvent.changeText(bassNameInput, 'Low End');
    expect(renameStemInProject).not.toHaveBeenCalled();

    // A single-line TextInput's default blurOnSubmit already blurs it on
    // submit, so only `onBlur` is wired - see StemNameField.
    fireEvent(bassNameInput, 'blur');

    await waitFor(() =>
      expect(renameStemInProject).toHaveBeenCalledWith(
        filesystemProject.sourceDir,
        'bass',
        'Low End'
      )
    );
    expect(renameStemInProject).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        store
          .getState()
          .projects.entities['my-song']?.tracks.find((t) => t.id === 'bass')?.name
      ).toBe('Low End')
    );
  });

  it('ignores an empty rename instead of blanking the stem name', async () => {
    renderEditable();
    await waitFor(() => expect(screen.getByTestId('edit-button')).toBeTruthy());
    fireEvent.press(screen.getByTestId('edit-button'));

    const bassNameInput = screen.getByTestId('rename-stem-bass');
    fireEvent.changeText(bassNameInput, '   ');
    fireEvent(bassNameInput, 'blur');

    expect(renameStemInProject).not.toHaveBeenCalled();
    expect(bassNameInput.props.value).toBe('Bass');
  });

  // The field shows the new name immediately (so typing feels responsive),
  // but that's only a guess until the write actually persists - a failed
  // write must not leave the input drifted from what's really on disk.
  it('reverts the displayed name if the rename write fails', async () => {
    (renameStemInProject as jest.Mock).mockRejectedValue(new Error('disk full'));

    renderEditable();
    await waitFor(() => expect(screen.getByTestId('edit-button')).toBeTruthy());
    fireEvent.press(screen.getByTestId('edit-button'));

    const bassNameInput = screen.getByTestId('rename-stem-bass');
    fireEvent.changeText(bassNameInput, 'Low End');
    fireEvent(bassNameInput, 'blur');

    await waitFor(() => expect(renameStemInProject).toHaveBeenCalled());
    await waitFor(() => expect(bassNameInput.props.value).toBe('Bass'));
    expect(screen.getByText('disk full')).toBeTruthy();
  });
});

describe('ProjectScreen - a brand-new (stemless) project', () => {
  const draft = {
    id: 'untitled-abc',
    title: 'Untitled',
    key: '',
    tracks: [],
    sections: [],
    origin: 'filesystem' as const,
    sourceDir: 'file:///mock/document/projects/untitled-abc',
  };

  function renderDraft() {
    mockParams = { projectId: draft.id };
    const store = createStore();
    store.dispatch(projectAdded(draft));
    return renderWithStore(<ProjectScreen />, store);
  }

  // "Creating a project" is just opening one that has no stems yet - there is
  // no separate new-project screen to land on.
  it('opens straight into the editor, not the mixer', () => {
    renderDraft();

    expect(screen.getByTestId('title-input')).toBeTruthy();
    expect(screen.getByTestId('save-button')).toBeTruthy();
    expect(screen.queryByTestId('mixer-menu-button')).toBeNull();
  });

  it('saves metadata on a stemless project without needing stems first', async () => {
    (updateProjectMetadata as jest.Mock).mockResolvedValue({});
    renderDraft();

    fireEvent.changeText(screen.getByTestId('title-input'), 'My New Song');
    fireEvent.press(screen.getByTestId('save-button'));

    await waitFor(() =>
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        draft.sourceDir,
        expect.objectContaining({ title: 'My New Song', bpm: undefined })
      )
    );
  });

  // Otherwise every abandoned "+ New" would leave an empty project behind,
  // and there is no delete-project UI to clean it up with.
  it('discards the empty draft when backing out', async () => {
    const { store } = renderDraft();

    fireEvent.press(screen.getByTestId('back-button'));

    await waitFor(() =>
      expect(deleteProjectDirectory).toHaveBeenCalledWith(draft.sourceDir)
    );
    expect(store.getState().projects.entities[draft.id]).toBeUndefined();
    expect(mockBack).toHaveBeenCalled();
  });

  it('keeps a project that already has stems when backing out', async () => {
    mockParams = { projectId: 'my-song' };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    renderWithStore(<ProjectScreen />, store);

    fireEvent.press(screen.getByTestId('back-button'));

    expect(deleteProjectDirectory).not.toHaveBeenCalled();
    expect(store.getState().projects.entities['my-song']).toBeTruthy();
  });
});

// AudioEngine.loadProject() opens with stop() + disposeTracks(), and every
// edit path ends in a reload() that calls it - so an edit mid-song cuts the
// song off and tears the graph down. On stage that is the worst possible
// failure, so nothing that rebuilds is reachable while the transport runs.
describe('ProjectScreen - locked while playing', () => {
  /** A project that both loads (so there's a mixer) and is editable (so Edit exists). */
  function renderEditing() {
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: filesystemProject,
      resolveFile: () => 0,
    });
    mockParams = { projectId: 'my-song' };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    store.dispatch(
      tracksInitializedForProject({
        projectId: filesystemProject.id,
        tracks: filesystemProject.tracks,
      })
    );
    return renderWithStore(<ProjectScreen />, store);
  }

  afterEach(() => {
    audioEngine.stop();
  });

  it('offers no Edit button while the transport is running', async () => {
    renderEditing();
    await waitForMixer();
    audioEngine.play();

    openMixer();

    expect(screen.queryByTestId('edit-button')).toBeNull();
    expect(screen.getByTestId('edit-locked-reason')).toBeTruthy();
  });

  it('offers Edit when the transport is stopped', async () => {
    renderEditing();
    await waitForMixer();

    openMixer();

    expect(screen.getByTestId('edit-button')).toBeTruthy();
    expect(screen.queryByTestId('edit-locked-reason')).toBeNull();
  });

  // The buttons are hidden, but a stale tap or a race must not get through
  // either - these are guarded at the handler, which is what actually calls
  // reload().
  it('refuses to import, remove or save while playing, even if invoked directly', async () => {
    renderEditing();
    await waitForMixer();
    openMixer();
    fireEvent.press(screen.getByTestId('edit-button'));

    audioEngine.play();
    pickerMock.mockResolvedValue({
      canceled: false,
      assets: [asset('gtr.wav', 'file:///tmp/gtr.wav')],
    });

    fireEvent.press(screen.getByTestId('pick-files-button'));
    fireEvent.press(screen.getByTestId('remove-stem-bass'));
    fireEvent.press(screen.getByTestId('save-button'));

    await waitFor(() =>
      expect(screen.getByText(/Stop playback first/)).toBeTruthy()
    );
    expect(addStemsToProject).not.toHaveBeenCalled();
    expect(removeStemFromProject).not.toHaveBeenCalled();
    expect(updateProjectMetadata).not.toHaveBeenCalled();
    // The whole point: the song kept playing.
    expect(audioEngine.getTransportState()).toBe('playing');
  });

  // Renaming only rewrites a label and patches the snapshot - it never
  // reloads, so blocking it would be needless restriction mid-set.
  it('still allows renaming a stem while playing', async () => {
    (renameStemInProject as jest.Mock).mockResolvedValue(filesystemProject);
    renderEditing();
    await waitForMixer();
    openMixer();
    fireEvent.press(screen.getByTestId('edit-button'));

    audioEngine.play();
    const field = screen.getByTestId('rename-stem-bass');
    fireEvent.changeText(field, 'Low End');
    fireEvent(field, 'blur');

    await waitFor(() => expect(renameStemInProject).toHaveBeenCalled());
    expect(audioEngine.getTransportState()).toBe('playing');
  });
});

describe('ProjectScreen - deleting', () => {
  async function renderEditableInEditMode() {
    mockParams = { projectId: 'my-song' };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    store.dispatch(
      tracksInitializedForProject({
        projectId: filesystemProject.id,
        tracks: filesystemProject.tracks,
      })
    );
    const rendered = renderWithStore(<ProjectScreen />, store);
    // This fake sourceDir has no real manifest.json behind it, so the load
    // always fails - Edit has to stay reachable straight from the error
    // state (see ProjectScreen's error branch), not behind the mixer drawer.
    await waitFor(() => expect(screen.getByTestId('edit-button')).toBeTruthy());
    fireEvent.press(screen.getByTestId('edit-button'));
    return rendered;
  }

  /** Drives Alert.alert by invoking the button matching `label`. */
  function answerAlertWith(label: string) {
    return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === label)?.onPress?.();
    });
  }

  // Deleting needs a folder to delete. Nothing produces a sourceDir-less
  // entry now that the bundled demo is gone, but the guard is still there and
  // a project the app can't locate must not offer to destroy it.
  it('is not offered for a project with no source directory', () => {
    mockParams = { projectId: 'no-dir' };
    const store = createStore();
    store.dispatch(
      projectAdded({
        id: 'no-dir',
        title: 'No Directory',
        key: '',
        tracks: [],
        sections: [],
        origin: 'filesystem',
      })
    );
    renderWithStore(<ProjectScreen />, store);

    // A stemless project opens straight into the form - the only view that
    // ever offers delete.
    expect(screen.getByTestId('save-button')).toBeTruthy();
    expect(screen.queryByTestId('delete-project-button')).toBeNull();
  });

  // Deleting destroys the audio files, so it must never happen on one tap.
  it('asks before deleting anything', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderEditableInEditMode();

    fireEvent.press(screen.getByTestId('delete-project-button'));

    expect(alertSpy).toHaveBeenCalled();
    expect(deleteProjectDirectory).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('deletes the folder, the entry and its mixer state once confirmed', async () => {
    answerAlertWith('Delete');
    const { store } = await renderEditableInEditMode();

    fireEvent.press(screen.getByTestId('delete-project-button'));

    expect(deleteProjectDirectory).toHaveBeenCalledWith(filesystemProject.sourceDir);
    expect(store.getState().projects.entities['my-song']).toBeUndefined();
    expect(
      store.getState().tracks.entities[trackEntityId('my-song', 'bass')]
    ).toBeUndefined();
    expect(mockBack).toHaveBeenCalled();
  });

  it('leaves everything alone when the confirmation is dismissed', async () => {
    answerAlertWith('Cancel');
    const { store } = await renderEditableInEditMode();

    fireEvent.press(screen.getByTestId('delete-project-button'));

    expect(deleteProjectDirectory).not.toHaveBeenCalled();
    expect(store.getState().projects.entities['my-song']).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('keeps the project if deleting the folder fails', async () => {
    answerAlertWith('Delete');
    (deleteProjectDirectory as jest.Mock).mockImplementationOnce(() => {
      throw new Error('disk busy');
    });
    const { store } = await renderEditableInEditMode();

    fireEvent.press(screen.getByTestId('delete-project-button'));

    expect(store.getState().projects.entities['my-song']).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByText('disk busy')).toBeTruthy();
  });

  // Unlike the fake-sourceDir cases above (which never actually load), this
  // one loads for real, so it's the one that exercises nowPlayingStore's
  // closeIfCurrent - deleting the project that's actually loaded/playing
  // must stop it, not leave it playing under a deleted project.
  it('stops the engine when deleting the project that is currently loaded and playing', async () => {
    answerAlertWith('Delete');
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: filesystemProject,
      resolveFile: () => 0,
    });
    mockParams = { projectId: 'my-song' };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    renderWithStore(<ProjectScreen />, store);
    await waitForMixer();
    // Edit can't be opened mid-song any more (see "locked while playing"), so
    // open it first and start playback after - what's under test is that
    // deleting a *playing* project stops the engine, not how Edit was reached.
    openMixer();
    fireEvent.press(screen.getByTestId('edit-button'));
    audioEngine.play();

    fireEvent.press(screen.getByTestId('delete-project-button'));

    expect(audioEngine.getTransportState()).toBe('stopped');
    expect(deleteProjectDirectory).toHaveBeenCalledWith(filesystemProject.sourceDir);
  });
});
