import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { audioEngine } from '@/engine';
import { nowPlayingStore } from '@/playback/nowPlayingStore';
import { decodeProjectAudio, getProjectSourceForEntry } from '@/storage';
import type { LibraryProjectEntry } from '@/store/projectsSlice';
import { renderWithStore } from '@/test-utils/renderWithStore';
import { NowPlayingBar } from './NowPlayingBar';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/storage', () => ({
  ...jest.requireActual('@/storage'),
  getProjectSourceForEntry: jest.fn(),
  decodeProjectAudio: jest.fn(),
}));

const getSourceMock = getProjectSourceForEntry as jest.Mock;
const decodeMock = decodeProjectAudio as jest.Mock;

const entry: LibraryProjectEntry = {
  id: 'my-song',
  title: 'My Song',
  key: '',
  tracks: [{ id: 'a', name: 'A', file: 'a.wav', gain: 1, bus: 'main' }],
  sections: [],
  origin: 'filesystem',
  sourceDir: 'file:///mock/my-song',
};

// usePlayhead's requestAnimationFrame loop ticks independently of React's
// act() batching - see ProjectScreen.test.tsx for the same guard.
beforeEach(() => {
  jest.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(0);
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPush.mockClear();
  nowPlayingStore.resetForTests();
  getSourceMock.mockResolvedValue({ manifest: entry, resolveFile: () => 0 });
  decodeMock.mockResolvedValue({ manifest: entry, trackBuffers: {} });
});

describe('NowPlayingBar', () => {
  it('renders nothing when no project is loaded', () => {
    renderWithStore(<NowPlayingBar />);

    expect(screen.queryByTestId('now-playing-bar')).toBeNull();
  });

  // This component is mounted for the app's whole lifetime (see
  // `_layout.tsx`) - if it polled the playhead even while rendering
  // nothing, that would burn CPU on every screen for as long as the app is
  // open, not just a one-time cost. The hooks that poll live only in the
  // child that's conditionally mounted once something is actually loaded.
  it('does not start the playhead polling loop until a project is actually loaded', async () => {
    renderWithStore(<NowPlayingBar />);
    expect(requestAnimationFrame).not.toHaveBeenCalled();

    await nowPlayingStore.openProject(entry, { monitorMode: 'split', clickEnabled: true });

    await waitFor(() => expect(requestAnimationFrame).toHaveBeenCalled());
  });

  it('shows the loaded project once one is open', async () => {
    renderWithStore(<NowPlayingBar />);
    await nowPlayingStore.openProject(entry, { monitorMode: 'split', clickEnabled: true });

    await waitFor(() => expect(screen.getByTestId('now-playing-bar')).toBeTruthy());
    expect(screen.getByText('My Song')).toBeTruthy();
  });

  it('navigates to the loaded project when tapped', async () => {
    renderWithStore(<NowPlayingBar />);
    await nowPlayingStore.openProject(entry, { monitorMode: 'split', clickEnabled: true });
    await waitFor(() => expect(screen.getByTestId('now-playing-bar')).toBeTruthy());

    fireEvent.press(screen.getByTestId('now-playing-bar'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/project/[projectId]',
      params: { projectId: 'my-song' },
    });
  });

  it('play/pause drives the real audio engine transport without navigating', async () => {
    renderWithStore(<NowPlayingBar />);
    await nowPlayingStore.openProject(entry, { monitorMode: 'split', clickEnabled: true });
    await waitFor(() => expect(screen.getByTestId('play-pause-button')).toBeTruthy());

    fireEvent.press(screen.getByTestId('play-pause-button'));

    expect(audioEngine.getTransportState()).toBe('playing');
    expect(mockPush).not.toHaveBeenCalled();
    audioEngine.stop();
  });
});
