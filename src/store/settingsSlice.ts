import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MonitorMode } from '@/engine';
import type { Locale } from '@/i18n';
import { readAppSettings } from '@/storage/appSettings';
import { isThemeOverride, type ThemeOverride } from '@/types/theme';
import { DEFAULT_LYRICS_FONT_SIZE_PT } from '@/ui/lyricsScroll';
import { resolveLibraryOrder } from '@/ui/libraryTree';

export interface SettingsState {
  /**
   * Global on purpose: this describes how the headphone splitter is wired at
   * a given gig, not anything about a song. The click toggle, by contrast,
   * is per-project and lives in the project's manifest.
   */
  monitorMode: MonitorMode;
  /** Manually picked on the About screen. `null` means "follow the device locale". */
  languageOverride: Locale | null;
  /**
   * The Library's top-level order, as `folder:`/`project:` keys (see
   * ui/libraryTree.ts). It can't live in projectsSlice's `ids` the way the
   * old project-only order did, because folders aren't projects.
   */
  libraryOrder: string[];
  /** The lyrics view's text size, in points - a performer/device preference, not a per-song one. See appSettings.ts. */
  lyricsFontSizePt: number;
  /** Whether the lyrics view renders in all caps - a reading preference, not a per-song one, same reasoning as `lyricsFontSizePt`. */
  lyricsAllCaps: boolean;
  /**
   * Whether ProjectScreen shows the lyrics view instead of the waveform.
   * Global rather than per-project so switching songs keeps showing lyrics
   * if that's the view the performer left it on - it's how they want to
   * read this set, not something about any one song.
   */
  lyricsViewActive: boolean;
  /** Manually picked on the Settings screen. Defaults to "dark" - the app has only ever been dark, so a fresh install must look exactly like it always has, not suddenly follow the device's setting. */
  themeOverride: ThemeOverride;
}

// Read once - `readAppSettings()` does a synchronous file read + JSON.parse,
// so calling it per-field here would multiply that I/O for no reason.
const persisted = readAppSettings();

const initialState: SettingsState = {
  monitorMode: 'split',
  languageOverride: persisted.languageOverride ?? null,
  libraryOrder: resolveLibraryOrder(persisted),
  lyricsFontSizePt: persisted.lyricsFontSizePt ?? DEFAULT_LYRICS_FONT_SIZE_PT,
  lyricsAllCaps: persisted.lyricsAllCaps ?? false,
  lyricsViewActive: persisted.lyricsViewActive ?? false,
  themeOverride: isThemeOverride(persisted.themeOverride) ? persisted.themeOverride : 'dark',
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    monitorModeSet(state, action: PayloadAction<MonitorMode>) {
      state.monitorMode = action.payload;
    },
    /**
     * State-only - disk persistence is a side effect and doesn't belong in a
     * reducer, so it's done by the `persistLanguageOverride` thunk
     * (store/persistSettings.ts) that dispatches this, not by callers
     * directly. See persistProject.ts for the same split elsewhere.
     */
    languageOverrideSet(state, action: PayloadAction<Locale | null>) {
      state.languageOverride = action.payload;
    },
    /** State-only, like the above; persisted by the persistLibraryOrder thunk. */
    libraryOrderSet(state, action: PayloadAction<string[]>) {
      state.libraryOrder = action.payload;
    },
    /** State-only, like the above; persisted by the persistLyricsFontSize thunk. */
    lyricsFontSizeSet(state, action: PayloadAction<number>) {
      state.lyricsFontSizePt = action.payload;
    },
    /** State-only, like the above; persisted by the persistLyricsAllCaps thunk. */
    lyricsAllCapsSet(state, action: PayloadAction<boolean>) {
      state.lyricsAllCaps = action.payload;
    },
    /** State-only, like the above; persisted by the persistLyricsViewActive thunk. */
    lyricsViewActiveSet(state, action: PayloadAction<boolean>) {
      state.lyricsViewActive = action.payload;
    },
    /** State-only, like the above; persisted by the persistThemeOverride thunk. */
    themeOverrideSet(state, action: PayloadAction<ThemeOverride>) {
      state.themeOverride = action.payload;
    },
  },
});

export const {
  monitorModeSet,
  languageOverrideSet,
  libraryOrderSet,
  lyricsFontSizeSet,
  lyricsAllCapsSet,
  lyricsViewActiveSet,
  themeOverrideSet,
} = settingsSlice.actions;
export default settingsSlice.reducer;
