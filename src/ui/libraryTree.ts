import type { PersistedAppSettings } from '@/storage/appSettings';
import type { LibraryProjectEntry } from '@/store/projectsSlice';
import type { SetlistManifest } from '@/types/setlist';

/**
 * The Library shows folders and loose songs interleaved in one list, the way
 * Postman or Insomnia show folders alongside requests. Both kinds therefore
 * share one ordering, which means one namespace of keys - hence the prefixes.
 */
export function folderKey(id: string): string {
  return `folder:${id}`;
}

export function songKey(id: string): string {
  return `project:${id}`;
}

export type LibraryItem =
  | {
      kind: 'folder';
      key: string;
      folder: SetlistManifest;
      /** The folder's songs, resolved and in the folder's own order. */
      songs: LibraryProjectEntry[];
    }
  | { kind: 'song'; key: string; project: LibraryProjectEntry };

/**
 * The saved top-level order, tolerating installs that predate folders.
 *
 * `projectOrder` was a flat list of project ids; `libraryOrder` is the same
 * idea over prefixed keys so folders can sit among the songs. Falling back to
 * the old key means an existing library keeps the order the user dragged it
 * into, instead of silently reshuffling the first time they update.
 */
export function resolveLibraryOrder(settings: PersistedAppSettings): string[] {
  if (settings.libraryOrder?.length) return settings.libraryOrder;
  return (settings.projectOrder ?? []).map(songKey);
}

/**
 * Arranges projects and folders into the list the Library renders.
 *
 * A song listed by any folder is shown inside it and *not* at the top level,
 * matching how a request in Postman lives in its collection rather than in
 * both places. A song listed by two folders appears in both - folders hold
 * ids, so membership is not exclusive.
 *
 * Ids that no longer resolve are dropped rather than rendered as blanks: a
 * folder outlives the songs it points at (a project can be deleted from the
 * project screen), and a folder full of ghosts is worse than a short folder.
 */
export function buildLibraryTree(
  projects: LibraryProjectEntry[],
  folders: SetlistManifest[],
  order: string[] = []
): LibraryItem[] {
  const byId = new Map(projects.map((project) => [project.id, project]));

  const folderItems: LibraryItem[] = folders.map((folder) => ({
    kind: 'folder',
    key: folderKey(folder.id),
    folder,
    songs: folder.songs
      .map((id) => byId.get(id))
      .filter((project): project is LibraryProjectEntry => project !== undefined),
  }));

  const filed = new Set(folders.flatMap((folder) => folder.songs));
  const looseItems: LibraryItem[] = projects
    .filter((project) => !filed.has(project.id))
    .map((project) => ({ kind: 'song', key: songKey(project.id), project }));

  // Folders first among the not-yet-ordered, so a folder the user just made
  // is visible without scrolling past a long song list to find it.
  return applyOrder([...folderItems, ...looseItems], order);
}

/**
 * Puts `items` into `order`, appending anything `order` doesn't mention in
 * its existing relative position. Same reconciliation as the Library's
 * project order before folders existed: a new item is never lost just
 * because the saved order predates it.
 */
function applyOrder(items: LibraryItem[], order: string[]): LibraryItem[] {
  if (order.length === 0) return items;

  const byKey = new Map(items.map((item) => [item.key, item]));
  const placed = order
    .map((key) => byKey.get(key))
    .filter((item): item is LibraryItem => item !== undefined);
  const placedKeys = new Set(placed.map((item) => item.key));

  return [...placed, ...items.filter((item) => !placedKeys.has(item.key))];
}
