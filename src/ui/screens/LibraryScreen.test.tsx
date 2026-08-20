import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { nowPlayingStore } from '@/playback/nowPlayingStore';
import { createDraftProject, getDemoLibraryEntry } from '@/storage';
import { createStore } from '@/store';
import { projectsHydrated, projectsSelectors, type LibraryProjectEntry } from '@/store/projectsSlice';
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
  nowPlayingStore.resetForTests();
});

/**
 * The Library no longer seeds itself - ProjectLibraryGate reads the library
 * off disk at app start and dispatches it - so these tests hand it an
 * already-hydrated store.
 */
function renderHydrated(extra: LibraryProjectEntry[] = []) {
  const store = createStore();
  store.dispatch(projectsHydrated([getDemoLibraryEntry(), ...extra]));
  return renderWithStore(<LibraryScreen />, store);
}

describe('LibraryScreen', () => {
  it('shows the bundled demo project once the library is hydrated', () => {
    renderHydrated();

    expect(screen.getByText('Demo: Sync Test')).toBeTruthy();
    expect(screen.getByText('120 BPM')).toBeTruthy();
    expect(screen.getByText('A minor')).toBeTruthy();
    expect(screen.getByText('3 stems')).toBeTruthy();
  });

  it('navigates to the project screen when a row is pressed', () => {
    renderHydrated();

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
    const { store } = renderHydrated();

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
      projectsHydrated([
        {
          id: 'free-time',
          title: 'Free Time',
          key: '',
          tracks: [],
          sections: [],
          origin: 'filesystem',
          sourceDir: 'file:///mock/document/projects/free-time',
        },
      ])
    );
    renderWithStore(<LibraryScreen />, store);

    expect(screen.getByText('Free Time')).toBeTruthy();
    expect(screen.queryByText(/BPM/)).toBeNull();
  });

  // Without this the Library flashes "No projects yet" on every launch
  // before the disk scan comes back.
  it('waits for hydration instead of claiming the library is empty', () => {
    renderWithStore(<LibraryScreen />, createStore());

    expect(screen.queryByText('No projects yet')).toBeNull();
    expect(screen.queryByText('Demo: Sync Test')).toBeNull();
  });

  it('shows the empty state once hydration finds nothing', () => {
    const store = createStore();
    store.dispatch(projectsHydrated([]));
    renderWithStore(<LibraryScreen />, store);

    expect(screen.getByText('No projects yet')).toBeTruthy();
  });

  it('offers no edit affordance for the bundled demo project', () => {
    renderHydrated();

    expect(screen.queryByTestId('edit-project-demo-sync-test')).toBeNull();
  });

  it('opens the overflow menu and navigates to About', () => {
    renderHydrated();

    fireEvent.press(screen.getByTestId('library-menu'));
    fireEvent.press(screen.getByTestId('menu-about'));

    expect(mockPush).toHaveBeenCalledWith('/about');
  });

  it('reorders projects with the move up/down buttons and persists it, without navigating', () => {
    const store = createStore();
    store.dispatch(
      projectsHydrated([
        getDemoLibraryEntry(),
        {
          id: 'second-song',
          title: 'Second Song',
          key: '',
          tracks: [],
          sections: [],
          origin: 'filesystem',
          sourceDir: 'file:///mock/document/projects/second-song',
        },
      ])
    );
    renderWithStore(<LibraryScreen />, store);

    // The first row can't move further up, the second can't move further down.
    expect(screen.getByTestId('project-row-demo-sync-test-move-up').props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByTestId('project-row-second-song-move-down').props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(screen.getByTestId('project-row-second-song-move-up'));

    expect(projectsSelectors.selectIds(store.getState().projects)).toEqual(['second-song', 'demo-sync-test']);
    // Reordering must never also trigger the row's own tap-to-open handler.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('marks the row for the currently-loaded project, and no other', async () => {
    renderHydrated([
      {
        id: 'second-song',
        title: 'Second Song',
        key: '',
        tracks: [],
        sections: [],
        origin: 'filesystem',
        sourceDir: 'file:///mock/document/projects/second-song',
      },
    ]);
    await nowPlayingStore.openProject(getDemoLibraryEntry(), {
      monitorMode: 'split',
      clickEnabled: true,
    });

    await waitFor(() =>
      expect(screen.getByTestId('project-row-demo-sync-test-now-playing')).toBeTruthy()
    );
    expect(screen.queryByTestId('project-row-second-song-now-playing')).toBeNull();

    // A plain View isn't an accessibility element by default, so a screen
    // reader would silently skip right over the indicator (and its label)
    // without these - see ProjectRow.
    const dot = screen.getByTestId('project-row-demo-sync-test-now-playing');
    expect(dot.props.accessible).toBe(true);
    expect(dot.props.accessibilityRole).toBe('image');
    expect(dot.props.accessibilityLabel).toBeTruthy();
  });

  it('has no separate edit affordance - opening a project is how you edit it', () => {
    renderHydrated([
      {
        id: 'my-song',
        title: 'My Song',
        bpm: 100,
        key: 'C',
        tracks: [],
        sections: [],
        origin: 'filesystem',
        sourceDir: 'file:///mock/document/projects/my-song',
      },
    ]);

    expect(screen.queryByTestId('edit-project-my-song')).toBeNull();
  });
});
