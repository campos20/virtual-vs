import { createStore } from './index';
import { persistLanguageOverride, persistLyricsAllCaps, persistLyricsFontSize } from './persistSettings';

jest.mock('@/storage/appSettings', () => ({
  readAppSettings: jest.fn(() => ({})),
  writeAppSettings: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { writeAppSettings } = require('@/storage/appSettings');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('persistLanguageOverride', () => {
  it('sets the override and persists it', () => {
    const store = createStore();

    store.dispatch(persistLanguageOverride('pt-BR'));

    expect(store.getState().settings.languageOverride).toBe('pt-BR');
    expect(writeAppSettings).toHaveBeenCalledWith({ languageOverride: 'pt-BR' });
  });

  it('persists clearing the override as undefined, not null', () => {
    const store = createStore();

    store.dispatch(persistLanguageOverride(null));

    expect(store.getState().settings.languageOverride).toBeNull();
    expect(writeAppSettings).toHaveBeenCalledWith({ languageOverride: undefined });
  });
});

describe('persistLyricsFontSize', () => {
  it('sets the font size and persists it', () => {
    const store = createStore();

    store.dispatch(persistLyricsFontSize(24));

    expect(store.getState().settings.lyricsFontSizePt).toBe(24);
    expect(writeAppSettings).toHaveBeenCalledWith({ lyricsFontSizePt: 24 });
  });
});

describe('persistLyricsAllCaps', () => {
  it('sets all-caps and persists it', () => {
    const store = createStore();

    store.dispatch(persistLyricsAllCaps(true));

    expect(store.getState().settings.lyricsAllCaps).toBe(true);
    expect(writeAppSettings).toHaveBeenCalledWith({ lyricsAllCaps: true });
  });
});
