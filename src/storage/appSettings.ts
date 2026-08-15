import { File, Paths } from 'expo-file-system';
import type { Locale } from '@/i18n';

export interface PersistedAppSettings {
  /** Manually chosen language, overriding the device locale. Absent means "follow the device". */
  languageOverride?: Locale;
}

const settingsFile = new File(Paths.document, 'settings.json');

/**
 * Synchronous on purpose: read once at store-creation time (see
 * settingsSlice's initialState), before the first render, so there's no
 * "flashes the wrong language, then swaps" window the way an async hydration
 * effect would have.
 */
export function readAppSettings(): PersistedAppSettings {
  if (!settingsFile.exists) return {};
  try {
    return JSON.parse(settingsFile.textSync());
  } catch {
    return {};
  }
}

/**
 * Failing to persist must never block the UI - the change is already live in
 * the store, and losing it only costs the user having to re-pick next time.
 */
export function writeAppSettings(changes: Partial<PersistedAppSettings>): void {
  try {
    const updated = { ...readAppSettings(), ...changes };
    settingsFile.write(JSON.stringify(updated, null, 2));
  } catch (error) {
    console.warn('Failed to persist app settings', error);
  }
}
