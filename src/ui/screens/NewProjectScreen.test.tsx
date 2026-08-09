import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { projectsSelectors } from '@/store/projectsSlice';
import { renderWithStore } from '@/test-utils/renderWithStore';
import { NewProjectScreen } from './NewProjectScreen';

const mockGetDocumentAsync = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: () => mockGetDocumentAsync(),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack }),
}));

beforeEach(() => {
  mockGetDocumentAsync.mockReset();
  mockReplace.mockClear();
  mockBack.mockClear();
});

/** Mirrors what expo-document-picker really does with `copyToCacheDirectory: true` - writes real bytes into the (mocked) filesystem and hands back their uri, so the screen's real copy-into-project-folder step has something real to copy. */
function seedPickedFile(name: string): DocumentPickerAsset {
  const file = new File(Paths.cache, `${Date.now()}-${Math.random()}-${name}`);
  file.write('fake-audio-bytes');
  return { uri: file.uri, name, lastModified: Date.now() };
}

describe('NewProjectScreen', () => {
  it('starts with no files selected and the create button disabled', () => {
    renderWithStore(<NewProjectScreen />);

    expect(screen.getByText('No files selected yet.')).toBeTruthy();
    expect(screen.getByTestId('create-project-button').props.accessibilityState?.disabled).toBe(true);
  });

  it('lists picked files and lets you remove one', async () => {
    mockGetDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [seedPickedFile('bass.wav'), seedPickedFile('keys.wav')],
    });
    renderWithStore(<NewProjectScreen />);

    fireEvent.press(screen.getByTestId('pick-files-button'));

    await waitFor(() => expect(screen.getByText('bass.wav')).toBeTruthy());
    expect(screen.getByText('keys.wav')).toBeTruthy();

    fireEvent.press(screen.getAllByText('Remove')[0]);

    expect(screen.queryByText('bass.wav')).toBeNull();
    expect(screen.getByText('keys.wav')).toBeTruthy();
  });

  it('does nothing when the picker is canceled', async () => {
    mockGetDocumentAsync.mockResolvedValueOnce({ canceled: true, assets: null });
    renderWithStore(<NewProjectScreen />);

    fireEvent.press(screen.getByTestId('pick-files-button'));

    await waitFor(() => expect(mockGetDocumentAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByText('No files selected yet.')).toBeTruthy();
  });

  it('creates a filesystem project from the picked stems and navigates to it', async () => {
    mockGetDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [seedPickedFile('bass.wav'), seedPickedFile('guide vocal.wav')],
    });
    const { store } = renderWithStore(<NewProjectScreen />);

    fireEvent.press(screen.getByTestId('pick-files-button'));
    await waitFor(() => expect(screen.getByText('bass.wav')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('title-input'), 'Friday Rehearsal');
    fireEvent.changeText(screen.getByTestId('bpm-input'), '96');

    expect(screen.getByTestId('create-project-button').props.accessibilityState?.disabled).toBe(false);
    fireEvent.press(screen.getByTestId('create-project-button'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));

    const [[navigation]] = mockReplace.mock.calls;
    expect(navigation.pathname).toBe('/player/[projectId]');
    const projectId = navigation.params.projectId as string;

    const entry = projectsSelectors.selectById(store.getState().projects, projectId);
    expect(entry).toMatchObject({
      title: 'Friday Rehearsal',
      bpm: 96,
      origin: 'filesystem',
      tracks: [
        { name: 'bass', gain: 1, bus: 'main' },
        { name: 'guide vocal', gain: 1, bus: 'main' },
      ],
    });
    expect(entry?.sourceDir).toBeTruthy();
  });

  it('navigates back when cancel is pressed', () => {
    renderWithStore(<NewProjectScreen />);

    fireEvent.press(screen.getByTestId('cancel-button'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
