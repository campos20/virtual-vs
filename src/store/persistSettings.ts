import type { Locale } from '@/i18n';
import { writeAppSettings } from '@/storage/appSettings';
import type { ThemeOverride } from '@/types/theme';
import type { AppDispatch } from './index';
import {
  languageOverrideSet,
  lyricsAllCapsSet,
  lyricsFontSizeSet,
  lyricsViewActiveSet,
  themeOverrideSet,
} from './settingsSlice';

/** Sets the manual language override (or `null` to follow the device locale again) and persists it. */
export function persistLanguageOverride(locale: Locale | null) {
  return (dispatch: AppDispatch) => {
    dispatch(languageOverrideSet(locale));
    writeAppSettings({ languageOverride: locale ?? undefined });
  };
}

/** Sets the lyrics view's font size and persists it - a device/performer preference, not a per-project one, see appSettings.ts. */
export function persistLyricsFontSize(sizePt: number) {
  return (dispatch: AppDispatch) => {
    dispatch(lyricsFontSizeSet(sizePt));
    writeAppSettings({ lyricsFontSizePt: sizePt });
  };
}

/** Sets the lyrics view's all-caps display and persists it - a reading preference, not a per-project one, see appSettings.ts. */
export function persistLyricsAllCaps(allCaps: boolean) {
  return (dispatch: AppDispatch) => {
    dispatch(lyricsAllCapsSet(allCaps));
    writeAppSettings({ lyricsAllCaps: allCaps });
  };
}

/** Sets whether ProjectScreen shows the lyrics view and persists it - global, so switching songs keeps the view the performer left it on, see appSettings.ts. */
export function persistLyricsViewActive(active: boolean) {
  return (dispatch: AppDispatch) => {
    dispatch(lyricsViewActiveSet(active));
    writeAppSettings({ lyricsViewActive: active });
  };
}

/** Sets the manual theme override ("system" follows the device's own light/dark setting) and persists it. */
export function persistThemeOverride(theme: ThemeOverride) {
  return (dispatch: AppDispatch) => {
    dispatch(themeOverrideSet(theme));
    writeAppSettings({ themeOverride: theme });
  };
}
