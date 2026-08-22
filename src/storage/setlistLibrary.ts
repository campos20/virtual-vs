import { File } from 'expo-file-system';
import type { SetlistManifest } from '@/types/setlist';
import {
  ensureSetlistsDirectoryExists,
  setlistFile,
  setlistsDirectory,
} from './paths';

/** Name a freshly created folder carries until the user renames it. */
export const DRAFT_FOLDER_NAME = 'New folder';

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'folder';
}

/** Enough of a manifest to be usable - anything less is treated as corrupt and skipped. */
function isUsable(manifest: unknown): manifest is SetlistManifest {
  const candidate = manifest as SetlistManifest | null;
  return Boolean(candidate?.id) && typeof candidate?.name === 'string' && Array.isArray(candidate?.songs);
}

/**
 * Reads every folder off disk.
 *
 * Deliberately mirrors listFilesystemProjects(): one unreadable folder
 * (partially written, hand-edited) is skipped rather than failing the scan,
 * because losing the whole Library right before a set is a far worse outcome
 * than losing one folder.
 */
export async function listSetlists(): Promise<SetlistManifest[]> {
  ensureSetlistsDirectoryExists();

  const files = setlistsDirectory
    .list()
    .filter((item): item is File => item instanceof File && item.name.endsWith('.json'));

  const manifests = await Promise.all(
    files.map(async (file): Promise<SetlistManifest | null> => {
      try {
        const manifest = await file.json();
        return isUsable(manifest) ? manifest : null;
      } catch {
        return null;
      }
    })
  );

  return manifests.filter((manifest): manifest is SetlistManifest => manifest !== null);
}

/**
 * Writes a folder's whole file.
 *
 * There is deliberately no read-modify-write patch helper here, unlike
 * patchProjectManifest: a folder is small and fully mirrored in the store,
 * which is hydrated from these files at launch and is the only thing that
 * writes them. Merging onto the store's copy instead of re-reading keeps a
 * Library action synchronous - no await between the tap and the row moving -
 * and removes the "file vanished underneath us" failure mode from the middle
 * of a UI gesture.
 */
export function writeSetlist(manifest: SetlistManifest): void {
  ensureSetlistsDirectoryExists();
  setlistFile(manifest.id).write(JSON.stringify(manifest, null, 2));
}

export function createSetlist(name = DRAFT_FOLDER_NAME): SetlistManifest {
  const manifest: SetlistManifest = {
    id: `${slugify(name)}-${Date.now().toString(36)}`,
    name,
    songs: [],
    // Controller defaults, unused until setlist mode exists. Written now so
    // the file is already the shape that feature will expect.
    advance: 'manual',
    padBetween: false,
  };
  writeSetlist(manifest);
  return manifest;
}

/** Deletes a folder. The songs it listed are untouched - they simply become loose again. */
export function deleteSetlist(id: string): void {
  const file = setlistFile(id);
  if (file.exists) file.delete();
}
