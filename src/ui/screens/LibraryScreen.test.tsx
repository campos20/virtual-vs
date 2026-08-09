import { fireEvent, screen } from '@testing-library/react-native';
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
});
