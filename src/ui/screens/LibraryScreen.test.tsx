import { fireEvent, screen } from '@testing-library/react-native';
import { createStore } from '@/store';
import { projectAdded } from '@/store/projectsSlice';
import { renderWithStore } from '@/test-utils/renderWithStore';
import { LibraryScreen } from './LibraryScreen';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
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
      pathname: '/player/[projectId]',
      params: { projectId: 'demo-sync-test' },
    });
  });

  it('navigates to the new-project screen when "+ New" is pressed', () => {
    renderWithStore(<LibraryScreen />);

    fireEvent.press(screen.getByTestId('new-project-button'));

    expect(mockPush).toHaveBeenCalledWith('/new-project');
  });

  it('offers no edit affordance for the bundled demo project', () => {
    renderWithStore(<LibraryScreen />);

    expect(screen.queryByTestId('edit-project-demo-sync-test')).toBeNull();
  });

  it('navigates to the edit-project screen for a filesystem project', () => {
    const store = createStore();
    store.dispatch(
      projectAdded({
        id: 'my-song',
        title: 'My Song',
        bpm: 100,
        key: 'C',
        countInBars: 2,
        tracks: [],
        sections: [],
        origin: 'filesystem',
        sourceDir: 'file:///mock/document/projects/my-song',
      })
    );
    renderWithStore(<LibraryScreen />, store);

    fireEvent.press(screen.getByTestId('edit-project-my-song'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/edit-project/[projectId]',
      params: { projectId: 'my-song' },
    });
  });
});
