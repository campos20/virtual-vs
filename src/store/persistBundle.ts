import type { File } from 'expo-file-system';
import { importBundle, type ImportedBundle } from '@/storage/bundle';
import { writeSetlist } from '@/storage/setlistLibrary';
import type { ProgressReporter } from '@/storage/progress';
import type { SetlistManifest } from '@/types/setlist';
import { folderKey } from '@/ui/libraryTree';
import type { AppDispatch, RootState } from './index';
import { persistLibraryOrder } from './persistFolders';
import { projectAdded } from './projectsSlice';
import { setlistAdded, setlistUpdated, setlistsSelectors } from './setlistsSlice';

/**
 * Unpacks a `.vvs` bundle and folds it into the library.
 *
 * The disk work happens first and entirely (storage/bundle.ts), then the store
 * is told what landed - so a failed or half-finished import can't leave the
 * Library showing projects whose audio isn't there.
 */
export function importBundleIntoLibrary(file: File, onProgress?: ProgressReporter) {
  return async (dispatch: AppDispatch, getState: () => RootState): Promise<ImportedBundle> => {
    const result = await importBundle(file, onProgress);

    for (const project of result.projects) dispatch(projectAdded(project));
    for (const folder of result.folders) mergeFolder(dispatch, getState, folder);

    return result;
  };
}

/**
 * Adds a folder from a bundle, or merges into one already here.
 *
 * Merging rather than replacing is what makes importing the same set twice
 * harmless, and what lets someone send you an updated set without wiping the
 * songs you added to your copy of it. Existing order is kept; anything new is
 * appended, so a set you have rehearsed doesn't reshuffle itself.
 */
function mergeFolder(
  dispatch: AppDispatch,
  getState: () => RootState,
  incoming: SetlistManifest
): void {
  const existing = setlistsSelectors.selectById(getState().setlists, incoming.id);

  if (!existing) {
    try {
      writeSetlist(incoming);
    } catch (error) {
      console.warn(`Failed to write imported folder "${incoming.id}"`, error);
      return;
    }
    dispatch(setlistAdded(incoming));
    dispatch(persistLibraryOrder([folderKey(incoming.id), ...getState().settings.libraryOrder]));
    return;
  }

  const songs = [...existing.songs, ...incoming.songs.filter((id) => !existing.songs.includes(id))];
  if (songs.length === existing.songs.length) return;

  const merged: SetlistManifest = { ...existing, songs };
  try {
    writeSetlist(merged);
  } catch (error) {
    console.warn(`Failed to merge imported folder "${incoming.id}"`, error);
    return;
  }
  dispatch(setlistUpdated({ id: incoming.id, changes: { songs } }));
}
