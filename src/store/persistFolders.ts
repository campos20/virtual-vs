import { writeAppSettings } from '@/storage/appSettings';
import { createSetlist, deleteSetlist, writeSetlist } from '@/storage/setlistLibrary';
import type { SetlistManifest } from '@/types/setlist';
import { folderKey } from '@/ui/libraryTree';
import type { AppDispatch, RootState } from './index';
import {
  setlistAdded,
  setlistRemoved,
  setlistUpdated,
  setlistsSelectors,
} from './setlistsSlice';
import { libraryOrderSet } from './settingsSlice';

/**
 * Library folder writes.
 *
 * Each one writes the file first and updates the store only if that
 * succeeded - the manifest is the record, so the store must never claim a
 * change that isn't on disk. A failed write leaves the row where it was,
 * which is the honest outcome; it's logged rather than surfaced, because
 * losing a grouping change is not worth an error dialog mid-set.
 *
 * All of this is synchronous. Folders hold song ids only, so nothing here
 * ever touches audio - which is what makes reorganising instant even for a
 * project of hundreds of megabytes, and why it is safe while a song is
 * loaded and playing.
 */

/** Persists the top-level order over folders and loose songs. */
export function persistLibraryOrder(orderedKeys: string[]) {
  return (dispatch: AppDispatch) => {
    dispatch(libraryOrderSet(orderedKeys));
    writeAppSettings({ libraryOrder: orderedKeys });
  };
}

/**
 * Creates a folder and places it at the top of the Library, so it's visible
 * immediately instead of appended below however many songs the user has.
 */
export function createFolder(name?: string) {
  return (dispatch: AppDispatch, getState: () => RootState): SetlistManifest | null => {
    let folder: SetlistManifest;
    try {
      folder = createSetlist(name);
    } catch (error) {
      // Same contract as every other write here: the file is the record, so a
      // folder that isn't on disk must not appear in the Library either.
      console.warn('Failed to create a folder', error);
      return null;
    }

    dispatch(setlistAdded(folder));
    dispatch(persistLibraryOrder([folderKey(folder.id), ...getState().settings.libraryOrder]));
    return folder;
  };
}

export function renameFolder(id: string, name: string) {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    patch(dispatch, getState, id, { name });
  };
}

/**
 * Deletes a folder. Its songs are untouched - no audio is involved, so they
 * simply become loose again and reappear at the top level.
 */
export function deleteFolder(id: string) {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    try {
      deleteSetlist(id);
    } catch (error) {
      console.warn(`Failed to delete folder "${id}"`, error);
      return;
    }
    dispatch(setlistRemoved(id));

    const key = folderKey(id);
    const order = getState().settings.libraryOrder;
    if (order.includes(key)) {
      dispatch(persistLibraryOrder(order.filter((entry) => entry !== key)));
    }
  };
}

/** No-ops if the song is already in the folder, so a double-tap can't duplicate a row. */
export function addSongToFolder(folderId: string, projectId: string) {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    const folder = selectFolder(getState(), folderId);
    if (!folder || folder.songs.includes(projectId)) return;
    patch(dispatch, getState, folderId, { songs: [...folder.songs, projectId] });
  };
}

export function removeSongFromFolder(folderId: string, projectId: string) {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    const folder = selectFolder(getState(), folderId);
    if (!folder) return;
    patch(dispatch, getState, folderId, {
      songs: folder.songs.filter((id) => id !== projectId),
    });
  };
}

export function reorderFolderSongs(folderId: string, songs: string[]) {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    patch(dispatch, getState, folderId, { songs });
  };
}

/**
 * Drops a deleted project from every folder that listed it.
 *
 * The Library already hides ids that don't resolve, so this is about not
 * leaving rot on disk - and about a project id being reused later not
 * silently reappearing inside old folders.
 */
export function removeSongFromAllFolders(projectId: string) {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    const folders = setlistsSelectors
      .selectAll(getState().setlists)
      .filter((folder) => folder.songs.includes(projectId));

    for (const folder of folders) {
      patch(dispatch, getState, folder.id, {
        songs: folder.songs.filter((id) => id !== projectId),
      });
    }
  };
}

function selectFolder(state: RootState, id: string): SetlistManifest | undefined {
  return setlistsSelectors.selectById(state.setlists, id);
}

/** Merges `changes` onto the store's copy, writes the file, then updates the store. */
function patch(
  dispatch: AppDispatch,
  getState: () => RootState,
  id: string,
  changes: Partial<Omit<SetlistManifest, 'id'>>
): void {
  const folder = selectFolder(getState(), id);
  if (!folder) return;

  const updated: SetlistManifest = { ...folder, ...changes, id };
  try {
    writeSetlist(updated);
  } catch (error) {
    console.warn(`Failed to write folder "${id}"`, error);
    return;
  }
  dispatch(setlistUpdated({ id, changes }));
}
