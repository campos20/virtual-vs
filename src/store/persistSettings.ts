import type { Locale } from '@/i18n';
import { writeAppSettings } from '@/storage/appSettings';
import type { AppDispatch } from './index';
import { languageOverrideSet } from './settingsSlice';

/** Sets the manual language override (or `null` to follow the device locale again) and persists it. */
export function persistLanguageOverride(locale: Locale | null) {
  return (dispatch: AppDispatch) => {
    dispatch(languageOverrideSet(locale));
    writeAppSettings({ languageOverride: locale ?? undefined });
  };
}
