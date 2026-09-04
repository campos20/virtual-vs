import { fireEvent, screen } from '@testing-library/react-native';
import { createStore } from '@/store';
import { languageOverrideSet, themeOverrideSet } from '@/store/settingsSlice';
import { renderWithStore } from '@/test-utils/renderWithStore';
import { SettingsScreen } from './SettingsScreen';

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

beforeEach(() => {
  mockBack.mockClear();
});

describe('SettingsScreen', () => {
  it('goes back to the library when the back button is pressed', () => {
    renderWithStore(<SettingsScreen />);

    fireEvent.press(screen.getByTestId('settings-back-button'));

    expect(mockBack).toHaveBeenCalled();
  });

  it('shows the current language collapsed behind a single row, not an open list', () => {
    renderWithStore(<SettingsScreen />);

    expect(screen.getByText('🌐 System')).toBeTruthy();
    expect(screen.queryByTestId('language-option-en')).toBeNull();
    expect(screen.queryByTestId('language-option-pt-BR')).toBeNull();
  });

  it('opens the language picker and selects an override, persisting it and re-rendering in that language', () => {
    const store = createStore();
    renderWithStore(<SettingsScreen />, store);

    fireEvent.press(screen.getByTestId('settings-language-menu'));
    fireEvent.press(screen.getByTestId('language-option-pt-BR'));

    expect(store.getState().settings.languageOverride).toBe('pt-BR');
    expect(screen.getByText('Configurações')).toBeTruthy();
    expect(screen.getByText('🇧🇷 Português (Brasil)')).toBeTruthy();
  });

  it('clears the language override by selecting System', () => {
    const store = createStore();
    store.dispatch(languageOverrideSet('pt-BR'));
    renderWithStore(<SettingsScreen />, store);

    fireEvent.press(screen.getByTestId('settings-language-menu'));
    fireEvent.press(screen.getByTestId('language-option-system'));

    expect(store.getState().settings.languageOverride).toBeNull();
  });

  it('shows the current theme collapsed behind a single row', () => {
    renderWithStore(<SettingsScreen />);

    expect(screen.getByText('🌙 Dark')).toBeTruthy();
    expect(screen.queryByTestId('theme-option-light')).toBeNull();
  });

  it('opens the theme picker and selects light, persisting it', () => {
    const store = createStore();
    renderWithStore(<SettingsScreen />, store);

    fireEvent.press(screen.getByTestId('settings-theme-menu'));
    fireEvent.press(screen.getByTestId('theme-option-light'));

    expect(store.getState().settings.themeOverride).toBe('light');
  });

  it('a preseeded light theme renders collapsed as Light', () => {
    const store = createStore();
    store.dispatch(themeOverrideSet('light'));
    renderWithStore(<SettingsScreen />, store);

    expect(screen.getByText('☀️ Light')).toBeTruthy();
  });
});
