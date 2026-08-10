import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { getDemoLibraryEntry } from '@/storage';
import { createStore } from '@/store';
import { projectAdded, projectsSelectors, type LibraryProjectEntry } from '@/store/projectsSlice';
import { renderWithStore } from '@/test-utils/renderWithStore';
import type { ProjectManifest } from '@/types/project';
import { EditProjectScreen } from './EditProjectScreen';

const mockBack = jest.fn();
let mockProjectId = 'my-song';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ projectId: mockProjectId }),
  useRouter: () => ({ back: mockBack }),
}));

beforeEach(() => {
  mockBack.mockClear();
  mockProjectId = 'my-song';
});

function seedFilesystemProject(): LibraryProjectEntry {
  const directory = new Directory(Paths.document, 'projects', 'my-song');
  directory.create({ intermediates: true, overwrite: true });

  const manifest: ProjectManifest = {
    id: 'my-song',
    title: 'My Song',
    bpm: 100,
    key: 'C',
    countInBars: 2,
    tracks: [{ id: 'bass', name: 'Bass', file: 'bass.wav', gain: 1, bus: 'main' }],
    sections: [],
  };
  new File(directory, 'manifest.json').write(JSON.stringify(manifest));

  return { ...manifest, origin: 'filesystem', sourceDir: directory.uri };
}

function renderWithProject(entry: LibraryProjectEntry) {
  const store = createStore();
  store.dispatch(projectAdded(entry));
  return renderWithStore(<EditProjectScreen />, store);
}

describe('EditProjectScreen', () => {
  it("pre-fills the form with the project's current metadata", () => {
    renderWithProject(seedFilesystemProject());

    expect(screen.getByTestId('title-input').props.value).toBe('My Song');
    expect(screen.getByTestId('bpm-input').props.value).toBe('100');
    expect(screen.getByTestId('key-input').props.value).toBe('C');
    expect(screen.getByTestId('count-in-input').props.value).toBe('2');
  });

  it('saves edits to both the manifest.json on disk and the store', async () => {
    const entry = seedFilesystemProject();
    const { store } = renderWithProject(entry);

    fireEvent.changeText(screen.getByTestId('title-input'), 'Friday Rehearsal');
    fireEvent.changeText(screen.getByTestId('bpm-input'), '128');
    fireEvent.changeText(screen.getByTestId('key-input'), 'A minor');
    fireEvent.changeText(screen.getByTestId('count-in-input'), '4');

    fireEvent.press(screen.getByTestId('save-button'));

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));

    const updated = projectsSelectors.selectById(store.getState().projects, 'my-song');
    expect(updated).toMatchObject({ title: 'Friday Rehearsal', bpm: 128, key: 'A minor', countInBars: 4 });

    const onDisk = await new File(new Directory(entry.sourceDir!), 'manifest.json').json();
    expect(onDisk).toMatchObject({ title: 'Friday Rehearsal', bpm: 128, key: 'A minor', countInBars: 4 });
    // Tracks aren't part of this edit form and must survive it untouched.
    expect(onDisk.tracks).toEqual(entry.tracks);
  });

  it('disables Save when the title is cleared or the bpm is invalid', () => {
    renderWithProject(seedFilesystemProject());

    fireEvent.changeText(screen.getByTestId('title-input'), '');
    expect(screen.getByTestId('save-button').props.accessibilityState?.disabled).toBe(true);

    fireEvent.changeText(screen.getByTestId('title-input'), 'Still My Song');
    fireEvent.changeText(screen.getByTestId('bpm-input'), '0');
    expect(screen.getByTestId('save-button').props.accessibilityState?.disabled).toBe(true);
  });

  it('navigates back without saving when cancel is pressed', () => {
    renderWithProject(seedFilesystemProject());

    fireEvent.press(screen.getByTestId('cancel-button'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("shows a notice instead of a form for the bundled demo project", () => {
    mockProjectId = 'demo-sync-test';
    renderWithProject(getDemoLibraryEntry());

    expect(screen.getByText("The bundled demo project can't be edited.")).toBeTruthy();
    expect(screen.queryByTestId('title-input')).toBeNull();
  });

  it('shows a not-found notice for an unknown project id', () => {
    mockProjectId = 'does-not-exist';
    renderWithStore(<EditProjectScreen />);

    expect(screen.getByText('Project not found.')).toBeTruthy();
  });
});
