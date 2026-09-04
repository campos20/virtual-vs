import { fireEvent, screen } from '@testing-library/react-native';
import { openBrowserAsync } from 'expo-web-browser';
import { renderWithStore } from '@/test-utils/renderWithStore';
import { AboutScreen } from './AboutScreen';

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

jest.mock('expo-constants', () => ({
  expoConfig: { version: '1.2.3' },
}));

beforeEach(() => {
  mockBack.mockClear();
  (openBrowserAsync as jest.Mock).mockClear();
});

describe('AboutScreen', () => {
  it('shows the developer credit and app version', () => {
    renderWithStore(<AboutScreen />);

    expect(screen.getByText('Developed by campos20')).toBeTruthy();
    expect(screen.getByText('Version 1.2.3')).toBeTruthy();
  });

  it('opens the GitHub repo in the browser', () => {
    renderWithStore(<AboutScreen />);

    fireEvent.press(screen.getByTestId('about-github-link'));

    expect(openBrowserAsync).toHaveBeenCalledWith('https://github.com/campos20/virtual-vs');
  });

  it('goes back to the library when the back button is pressed', () => {
    renderWithStore(<AboutScreen />);

    fireEvent.press(screen.getByTestId('about-back-button'));

    expect(mockBack).toHaveBeenCalled();
  });
});
