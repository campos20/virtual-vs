import { Directory } from 'expo-file-system';
import type { LibraryProjectEntry } from '@/store/projectsSlice';
import { getDemoLibraryEntry } from './demoProject';
import { ensureProjectsDirectoryExists, projectsDirectory } from './paths';
import { readProjectManifest } from './projectLoader';

/**
 * Rebuilds the project library by reading the projects directory.
 *
 * Each project already owns a `manifest.json` next to its stems, so the
 * filesystem is the store of record - there is no separate database to keep
 * in sync with it, and a project survives simply by existing on disk.
 *
 * A folder that can't be read (partially written, hand-edited, deleted
 * mid-scan) is skipped rather than failing the whole scan: one bad project
 * must not cost the user the rest of their library right before a set.
 */
export async function listFilesystemProjects(): Promise<LibraryProjectEntry[]> {
  ensureProjectsDirectoryExists();

  const directories = projectsDirectory
    .list()
    .filter((item): item is Directory => item instanceof Directory);

  const entries = await Promise.all(
    directories.map(async (directory): Promise<LibraryProjectEntry | null> => {
      try {
        const manifest = await readProjectManifest(directory);
        if (!manifest?.id || !Array.isArray(manifest.tracks)) return null;
        return { ...manifest, origin: 'filesystem', sourceDir: directory.uri };
      } catch {
        return null;
      }
    })
  );

  return entries.filter((entry): entry is LibraryProjectEntry => entry !== null);
}

/** The bundled demo plus everything found on disk, in the order the Library shows them. */
export async function loadProjectLibrary(): Promise<LibraryProjectEntry[]> {
  return [getDemoLibraryEntry(), ...(await listFilesystemProjects())];
}
