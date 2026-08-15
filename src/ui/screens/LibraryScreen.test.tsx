import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { createDraftProject } from '@/storage';
import { createStore } from '@/store';
import { projectAdded } from '@/store/projectsSlice';
import { renderWithStore } from '@/test-utils/renderWithStore';
import { LibraryScreen } from './LibraryScreen';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/storage', () => ({
  ...jest.requireActual('@/storage'),
  createDraftProject: jest.fn(),
}));

beforeEach(() => {
  mockPush.mockClear();
});

describe('LibraryScreen', () => {
  it('seeds and shows the bundled demo project on first launch', () => {
    renderWithStore(<LibraryScreen />);

    expect(screen.getByText('Demo: Sync Test')).toBeTruthy();
    expect(screen.getByText('120 BPM')).toBeTruthy();
    expect(screen.getByText('A minor')).toBeTruthy();
    expect(screen.getByText('3 stems')).toBeTruthy();
  });

  it('navigates to the player screen when a project row is pressed', () => {
    renderWithStore(<LibraryScreen />);

    fireEvent.press(screen.getByText('Demo: Sync Test'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/project/[projectId]',
      params: { projectId: 'demo-sync-test' },
    });
  });

  // There is no new-project screen: "+ New" creates an empty project and
  // opens it, so creating is just editing a project with no stems yet.
  it('creates an empty project and opens it when "+ New" is pressed', async () => {
    (createDraftProject as jest.Mock).mockResolvedValue({
      id: 'untitled-abc',
      title: 'Untitled',
      key: '',
      tracks: [],
      sections: [],
      origin: 'filesystem',
      sourceDir: 'file:///mock/document/projects/untitled-abc',
    });
    const { store } = renderWithStore(<LibraryScreen />);

    fireEvent.press(screen.getByTestId('new-project-button'));

    await waitFor(() => expect(createDraftProject).toHaveBeenCalled());
    await waitFor(() =>
      expect(store.getState().projects.entities['untitled-abc']).toBeTruthy()
    );
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/project/[projectId]',
      params: { projectId: 'untitled-abc' },
    });
  });

  it('omits the tempo pill for a project with no bpm', () => {
    const store = createStore();
    store.dispatch(
      projectAdded({
        id: 'free-time',
        title: 'Free Time',
        key: '',
        tracks: [],
        sections: [],
        origin: 'filesystem',
        sourceDir: 'file:///mock/document/projects/free-time',
      })
    );
    renderWithStore(<LibraryScreen />, store);

    expect(screen.getByText('Free Time')).toBeTruthy();
    expect(screen.queryByText(/BPM/)).toBeNull();
  });

  it('offers no edit affordance for the bundled demo project', () => {
    renderWithStore(<LibraryScreen />);

    expect(screen.queryByTestId('edit-project-demo-sync-test')).toBeNull();
  });

  it('has no separate edit affordance - opening a project is how you edit it', () => {
    const store = createStore();
    store.dispatch(
      projectAdded({
        id: 'my-song',
        title: 'My Song',
        bpm: 100,
        key: 'C',
        tracks: [],
        sections: [],
        origin: 'filesystem',
        sourceDir: 'file:///mock/document/projects/my-song',
      })
    );
    renderWithStore(<LibraryScreen />, store);

    expect(screen.queryByTestId('edit-project-my-song')).toBeNull();
  });
});
