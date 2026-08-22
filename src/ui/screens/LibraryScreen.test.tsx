import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { nowPlayingStore } from '@/playback/nowPlayingStore';
import { createDraftProject, getProjectSourceForEntry } from '@/storage';
import { createStore } from '@/store';
import { projectsHydrated, type LibraryProjectEntry } from '@/store/projectsSlice';
import { setlistsHydrated } from '@/store/setlistsSlice';
import type { SetlistManifest } from '@/types/setlist';
import { renderWithStore } from '@/test-utils/renderWithStore';
import { LibraryScreen } from './LibraryScreen';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/storage', () => ({
  ...jest.requireActual('@/storage'),
  createDraftProject: jest.fn(),
  getProjectSourceForEntry: jest.fn(),
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
/** A fully-specified project, so the row has a tempo, a key and a stem count to show. */
const syncTest: LibraryProjectEntry = {
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

function renderHydrated(extra: LibraryProjectEntry[] = []) {
  const store = createStore();
  store.dispatch(projectsHydrated([syncTest, ...extra]));
  return renderWithStore(<LibraryScreen />, store);
}

function song(id: string, title = id): LibraryProjectEntry {
  return {
    id,
    title,
    key: '',
    tracks: [],
    sections: [],
    origin: 'filesystem',
    sourceDir: `file:///mock/document/projects/${id}`,
  };
}

function folder(id: string, name: string, songs: string[] = []): SetlistManifest {
  return { id, name, songs, advance: 'manual', padBetween: false };
}

describe('LibraryScreen', () => {
  it('shows a project once the library is hydrated', () => {
    renderHydrated();

    expect(screen.getByText('Sync Test')).toBeTruthy();
    expect(screen.getByText('120 BPM')).toBeTruthy();
    expect(screen.getByText('A minor')).toBeTruthy();
    expect(screen.getByText('3 stems')).toBeTruthy();
  });

  it('navigates to the project screen when a row is pressed', () => {
    renderHydrated();

    fireEvent.press(screen.getByText('Sync Test'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/project/[projectId]',
      params: { projectId: 'sync-test' },
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
          expect(store.getState().projects.entities['untitled-abc']).toBeTruthy()
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
    expect(screen.queryByText('Sync Test')).toBeNull();
  });

  it('shows the empty state once hydration finds nothing', () => {
    const store = createStore();
    store.dispatch(projectsHydrated([]));
    renderWithStore(<LibraryScreen />, store);

    expect(screen.getByText('No projects yet')).toBeTruthy();
  });

  it('opens the overflow menu and navigates to About', () => {
    renderHydrated();

    fireEvent.press(screen.getByTestId('library-menu'));
    fireEvent.press(screen.getByTestId('menu-about'));

    expect(mockPush).toHaveBeenCalledWith('/about');
  });

  it('reorders projects with the move up/down buttons and persists it, without navigating', () => {
    const store = createStore();
    store.dispatch(projectsHydrated([syncTest, song('second-song')]));
    renderWithStore(<LibraryScreen />, store);

    // The first row can't move further up, the second can't move further down.
    expect(screen.getByTestId('project-row-sync-test-move-up').props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByTestId('project-row-second-song-move-down').props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(screen.getByTestId('project-row-second-song-move-up'));

    // The order covers folders as well as songs now, so it lives in settings
    // rather than in the projects slice's own `ids`.
    expect(store.getState().settings.libraryOrder).toEqual([
      'project:second-song',
      'project:sync-test',
    ]);
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
    // Loads for real, so it needs a source it can decode - the stems
    // themselves never have to exist, the audio mock decodes any ref.
    (getProjectSourceForEntry as jest.Mock).mockResolvedValue({
      manifest: syncTest,
      resolveFile: () => 0,
    });
    await nowPlayingStore.openProject(syncTest, {
      monitorMode: 'split',
      clickEnabled: true,
    });

          await waitFor(() =>
      expect(screen.getByTestId('project-row-sync-test-now-playing')).toBeTruthy()
    );
    expect(screen.queryByTestId('project-row-second-song-now-playing')).toBeNull();

    // A plain View isn't an accessibility element by default, so a screen
    // reader would silently skip right over the indicator (and its label)
    // without these - see ProjectRow.
    const dot = screen.getByTestId('project-row-sync-test-now-playing');
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

  // Folders are setlists (types/setlist.ts) shown as a Postman-style tree:
  // folders and loose songs in one list, a song filed in a folder shown
  // inside it rather than in both places.
  describe('folders', () => {
    function renderWithFolders(folders: SetlistManifest[], songs: LibraryProjectEntry[]) {
      const store = createStore();
      store.dispatch(projectsHydrated(songs));
      store.dispatch(setlistsHydrated(folders));
      return renderWithStore(<LibraryScreen />, store);
    }

    it('shows a folder with its songs nested inside, and loose songs outside', () => {
      renderWithFolders(
        [folder('sunday', 'Sunday Set', ['filed'])],
        [song('filed', 'Filed Song'), song('loose', 'Loose Song')]
      );

      expect(screen.getByText('Sunday Set')).toBeTruthy();
      expect(screen.getByText('1 song')).toBeTruthy();
      expect(screen.getByTestId('project-row-filed')).toBeTruthy();
      expect(screen.getByTestId('project-row-loose')).toBeTruthy();
    });

    it('starts expanded, and collapsing hides the songs it holds', () => {
      renderWithFolders([folder('sunday', 'Sunday Set', ['filed'])], [song('filed')]);

      // Expanded by default: a folder hides songs, and someone opening the
      // Library mid-set must not have to remember where each song is filed.
      expect(screen.getByTestId('project-row-filed')).toBeTruthy();

      fireEvent.press(screen.getByTestId('folder-row-sunday'));

      expect(screen.queryByTestId('project-row-filed')).toBeNull();
      expect(screen.getByText('Sunday Set')).toBeTruthy();
    });

    // A folder is a setlist, so its songs are found by position on stage.
    it('numbers songs inside a folder from 1', () => {
      renderWithFolders(
        [folder('sunday', 'Sunday Set', ['first', 'second', 'third'])],
        [song('first'), song('second'), song('third')]
      );

      expect(screen.getByTestId('project-row-first-position')).toHaveTextContent('1');
      expect(screen.getByTestId('project-row-second-position')).toHaveTextContent('2');
      expect(screen.getByTestId('project-row-third-position')).toHaveTextContent('3');
    });

    it('renumbers after a reorder, so the numbers are positions and not labels', () => {
      renderWithFolders(
        [folder('sunday', 'Sunday Set', ['first', 'second'])],
        [song('first'), song('second')]
      );

      fireEvent.press(screen.getByTestId('project-row-second-move-up'));

      expect(screen.getByTestId('project-row-second-position')).toHaveTextContent('1');
      expect(screen.getByTestId('project-row-first-position')).toHaveTextContent('2');
    });

    it('leaves loose songs unnumbered - there is no set for them to be fourth in', () => {
      renderWithFolders([folder('sunday', 'Sunday Set')], [song('loose')]);

      expect(screen.queryByTestId('project-row-loose-position')).toBeNull();
    });

    it('opens a song from inside a folder', () => {
      renderWithFolders([folder('sunday', 'Sunday Set', ['filed'])], [song('filed', 'Filed Song')]);

      fireEvent.press(screen.getByText('Filed Song'));

      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/project/[projectId]',
        params: { projectId: 'filed' },
      });
    });

    it('says a folder is empty rather than looking broken', () => {
      renderWithFolders([folder('sunday', 'Sunday Set')], [song('loose')]);

      expect(screen.getByText('0 songs')).toBeTruthy();
      expect(screen.getByText(/Empty/)).toBeTruthy();
    });

    // The empty state is about having nothing at all, not about having no
    // *songs*: a folder is something, and hiding it behind "No projects yet"
    // would make a folder the user just created look like it vanished.
    it('shows a folder even when there are no songs anywhere yet', () => {
      renderWithFolders([folder('sunday', 'Sunday Set')], []);

      expect(screen.getByText('Sunday Set')).toBeTruthy();
      expect(screen.queryByText('No projects yet')).toBeNull();
    });

    it('offers no song menu at all until a folder exists to file it in', () => {
      renderHydrated();

      expect(screen.queryByTestId('project-row-sync-test-menu')).toBeNull();
    });

    it('files a loose song into a folder from the song menu', async () => {
      const { store } = renderWithFolders([folder('sunday', 'Sunday Set')], [song('loose')]);

      fireEvent.press(screen.getByTestId('project-row-loose-menu'));
      fireEvent.press(screen.getByTestId('add-to-folder-sunday'));

              expect(store.getState().setlists.entities.sunday?.songs).toEqual(['loose'])
    });

    it('takes a song back out of a folder, leaving the song itself alone', async () => {
      const { store } = renderWithFolders(
        [folder('sunday', 'Sunday Set', ['filed'])],
        [song('filed')]
      );

      fireEvent.press(screen.getByTestId('project-row-filed-menu'));
      fireEvent.press(screen.getByTestId('remove-from-folder-sunday'));

      expect(store.getState().setlists.entities.sunday?.songs).toEqual([]);
      // The project is untouched - folders hold ids, not audio.
      expect(store.getState().projects.entities.filed).toBeTruthy();
    });

    it('lets the same song be filed in two folders at once', async () => {
      const { store } = renderWithFolders(
        [folder('sunday', 'Sunday Set', ['shared']), folder('wedding', 'Wedding Gig')],
        [song('shared')]
      );

      // The song is inside "Sunday Set", and its menu still offers the other
      // folder - one song genuinely belongs to two sets.
      fireEvent.press(screen.getByTestId('project-row-shared-menu'));
      fireEvent.press(screen.getByTestId('add-to-folder-wedding'));

              expect(store.getState().setlists.entities.wedding?.songs).toEqual(['shared'])
      expect(store.getState().setlists.entities.sunday?.songs).toEqual(['shared']);
    });

    it('reorders songs within a folder without touching the top-level order', async () => {
      const { store } = renderWithFolders(
        [folder('sunday', 'Sunday Set', ['first', 'second'])],
        [song('first'), song('second')]
      );

      fireEvent.press(screen.getByTestId('project-row-second-move-up'));

              expect(store.getState().setlists.entities.sunday?.songs).toEqual(['second', 'first'])
      expect(store.getState().settings.libraryOrder).toEqual([]);
    });

    it('renames a folder in place', async () => {
      const { store } = renderWithFolders([folder('sunday', 'Sunday Set')], []);

      fireEvent.press(screen.getByTestId('folder-row-sunday-menu'));
      fireEvent.press(screen.getByTestId('rename-folder-sunday'));
      fireEvent(screen.getByTestId('folder-row-sunday-rename-input'), 'submitEditing', {
        nativeEvent: { text: 'Wedding Gig' },
      });

              expect(store.getState().setlists.entities.sunday?.name).toBe('Wedding Gig')
    });

    it('ignores a rename to blank rather than leaving a nameless folder', async () => {
      const { store } = renderWithFolders([folder('sunday', 'Sunday Set')], []);

      fireEvent.press(screen.getByTestId('folder-row-sunday-menu'));
      fireEvent.press(screen.getByTestId('rename-folder-sunday'));
      fireEvent(screen.getByTestId('folder-row-sunday-rename-input'), 'submitEditing', {
        nativeEvent: { text: '   ' },
      });

      expect(store.getState().setlists.entities.sunday?.name).toBe('Sunday Set');
    });

    it('creates a folder at the top of the library and opens it for renaming', async () => {
      const { store } = renderWithFolders([], [song('loose')]);

      fireEvent.press(screen.getByTestId('new-folder-button'));

      const ids = Object.keys(store.getState().setlists.entities);
      expect(ids).toHaveLength(1);
      // First in the order, so it isn't created out of sight below the songs.
      expect(store.getState().settings.libraryOrder[0]).toBe(`folder:${ids[0]}`);
      // Straight into the rename field: "New folder" is never what was meant.
      expect(screen.getByTestId(`folder-row-${ids[0]}-rename-input`)).toBeTruthy();
    });
  });
});
