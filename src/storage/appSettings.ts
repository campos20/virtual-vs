import { File, Paths } from 'expo-file-system';
import type { Locale } from '@/i18n';

export interface PersistedAppSettings {
  /** Manually chosen language, overriding the device locale. Absent means "follow the device". */
  languageOverride?: Locale;
  /**
   * Project ids in the user's chosen Library order. Lives here rather than on
   * each project's own manifest.json because it is a property of the Library,
   * not of any one project - see storage/projectLibrary.ts for how a fresh
   * scan is reconciled against it.
   *
   * Superseded by `libraryOrder` below, and only read when that is absent -
   * kept so an install from before folders existed doesn't lose the order
   * its owner dragged it into.
   */
  projectOrder?: string[];
  /**
   * The Library's top-level order over *both* folders and loose songs, as
   * prefixed keys (`folder:x`, `project:y`) - see ui/libraryTree.ts. One list
   * rather than two because the two kinds interleave on screen. The order of
   * songs *within* a folder is not here; it lives in that folder's own
   * manifest, next to the membership it belongs to.
   */
  libraryOrder?: string[];
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
