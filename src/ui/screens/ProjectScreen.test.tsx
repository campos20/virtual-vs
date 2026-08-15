import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { getDocumentAsync } from 'expo-document-picker';
import { audioEngine } from '@/engine';
import {
  addStemsToProject,
  deleteProjectDirectory,
  getDemoLibraryEntry,
  getDemoProjectSource,
  getProjectSourceForEntry,
  removeStemFromProject,
  updateProjectMetadata,
} from '@/storage';
import { createStore } from '@/store';
import { projectAdded } from '@/store/projectsSlice';
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
  deleteProjectDirectory: jest.fn(),
  getProjectSourceForEntry: jest.fn(),
}));

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
  // Real behaviour by default; individual tests override it.
  (getProjectSourceForEntry as jest.Mock).mockImplementation(
    jest.requireActual('@/storage').getProjectSourceForEntry
  );
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

function renderDemo() {
  mockParams = { projectId: 'demo-sync-test' };
  const store = createStore();
  store.dispatch(projectAdded(getDemoLibraryEntry()));
  return renderWithStore(<ProjectScreen />, store);
}

async function waitForMixer() {
  await waitFor(() => expect(screen.getByText('Bass')).toBeTruthy());
}

describe('ProjectScreen - playing', () => {
  it('loads a project and renders a channel strip per track', async () => {
    renderDemo();
    await waitForMixer();

    expect(screen.getByText('Demo: Sync Test')).toBeTruthy();
    expect(screen.getByText('120 BPM')).toBeTruthy();
    expect(screen.getByText('Keys')).toBeTruthy();
    expect(screen.getByText('Guide Vocal')).toBeTruthy();
  });

  it('play/pause drives the real audio engine transport', async () => {
    renderDemo();
    await waitForMixer();

    fireEvent.press(screen.getByTestId('play-pause-button'));
    expect(audioEngine.getTransportState()).toBe('playing');
    expect(screen.getByTestId('pause-icon')).toBeTruthy();

    fireEvent.press(screen.getByTestId('play-pause-button'));
    expect(audioEngine.getTransportState()).toBe('paused');
  });

  it('toggling mute commits to the engine and the store', async () => {
    const { store } = renderDemo();
    await waitForMixer();

    const [bassMute] = screen.getAllByText('M');
    fireEvent.press(bassMute);

    expect(audioEngine.getTrackState('bass')?.muted).toBe(true);
    expect(
      store.getState().tracks.entities[trackEntityId('demo-sync-test', 'bass')]?.muted
    ).toBe(true);
  });

  // Guards the wiring a module-level `store.getState()` used to hide. Mute and
  // solo are the tell: AudioEngine's fallback for a track it wasn't given
  // state for hardcodes them off, so a screen that fails to pass the manifest
  // mix through would show a muted channel while playing it at full level.
  it('seeds the engine with the mix stored in the project manifest', async () => {
    const demo = getDemoProjectSource();
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      ...demo,
      manifest: {
        ...demo.manifest,
        tracks: demo.manifest.tracks.map((track) =>
          track.id === 'bass'
            ? { ...track, gain: 0.25, bus: 'both' as const, muted: true }
            : track.id === 'keys'
              ? { ...track, soloed: true }
              : track
        ),
      },
    });

    renderDemo();
    await waitForMixer();

    expect(audioEngine.getTrackState('bass')?.muted).toBe(true);
    expect(audioEngine.getTrackState('bass')?.volume).toBeCloseTo(0.25, 5);
    expect(audioEngine.getTrackState('bass')?.bus).toBe('both');
    expect(audioEngine.getTrackState('keys')?.soloed).toBe(true);
  });

  it('detaches the engine listener before stopping it on unmount', async () => {
    const detach = jest.fn();
    jest.spyOn(audioEngine, 'onTransportStateChange').mockReturnValue(detach);
    const stopSpy = jest.spyOn(audioEngine, 'stop');

    const { unmount } = renderDemo();
    await waitForMixer();
    stopSpy.mockClear();

    unmount();

    expect(detach.mock.invocationCallOrder[0]).toBeLessThan(
      stopSpy.mock.invocationCallOrder[0]
    );
  });
});

describe('ProjectScreen - editing in place', () => {
  function renderEditable() {
    mockParams = { projectId: 'my-song' };
    const store = createStore();
    store.dispatch(projectAdded(filesystemProject));
    return renderWithStore(<ProjectScreen />, store);
  }

  it('offers no Edit button for the bundled demo project', async () => {
    renderDemo();
    await waitForMixer();

    expect(screen.queryByTestId('edit-button')).toBeNull();
  });

  // Editing can delete the files the transport is reading, so entering edit
  // mode must always stop audio first.
  it('stops playback and swaps in the form when Edit is pressed', async () => {
    renderEditable();
    await waitFor(() => expect(screen.getByTestId('edit-button')).toBeTruthy());
    const stopSpy = jest.spyOn(audioEngine, 'stop');

    fireEvent.press(screen.getByTestId('edit-button'));

    expect(stopSpy).toHaveBeenCalled();
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
    expect(screen.queryByTestId('play-pause-button')).toBeNull();
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

describe('ProjectScreen - deleting', () => {
  function renderEditableInEditMode() {
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
    fireEvent.press(screen.getByTestId('edit-button'));
    return rendered;
  }

  /** Drives Alert.alert by invoking the button matching `label`. */
  function answerAlertWith(label: string) {
    return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === label)?.onPress?.();
    });
  }

  it('is not offered for the bundled demo project', async () => {
    renderDemo();
    await waitForMixer();

    expect(screen.queryByTestId('delete-project-button')).toBeNull();
  });

  // Deleting destroys the audio files, so it must never happen on one tap.
  it('asks before deleting anything', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderEditableInEditMode();

    fireEvent.press(screen.getByTestId('delete-project-button'));

    expect(alertSpy).toHaveBeenCalled();
    expect(deleteProjectDirectory).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('deletes the folder, the entry and its mixer state once confirmed', () => {
    answerAlertWith('Delete');
    const { store } = renderEditableInEditMode();

    fireEvent.press(screen.getByTestId('delete-project-button'));

    expect(deleteProjectDirectory).toHaveBeenCalledWith(filesystemProject.sourceDir);
    expect(store.getState().projects.entities['my-song']).toBeUndefined();
    expect(
      store.getState().tracks.entities[trackEntityId('my-song', 'bass')]
    ).toBeUndefined();
    expect(mockBack).toHaveBeenCalled();
  });

  it('leaves everything alone when the confirmation is dismissed', () => {
    answerAlertWith('Cancel');
    const { store } = renderEditableInEditMode();

    fireEvent.press(screen.getByTestId('delete-project-button'));

    expect(deleteProjectDirectory).not.toHaveBeenCalled();
    expect(store.getState().projects.entities['my-song']).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('keeps the project if deleting the folder fails', () => {
    answerAlertWith('Delete');
    (deleteProjectDirectory as jest.Mock).mockImplementationOnce(() => {
      throw new Error('disk busy');
    });
    const { store } = renderEditableInEditMode();

    fireEvent.press(screen.getByTestId('delete-project-button'));

    expect(store.getState().projects.entities['my-song']).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByText('disk busy')).toBeTruthy();
  });
});
