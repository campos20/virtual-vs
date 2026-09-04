import type { Locale } from '@/i18n';
import { writeAppSettings } from '@/storage/appSettings';
import type { AppDispatch } from './index';
import { languageOverrideSet, lyricsFontSizeSet } from './settingsSlice';

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
