import { Directory, File, Paths } from 'expo-file-system';

/** Root directory (under the app's document directory) where imported projects live. */
export const projectsDirectory = new Directory(Paths.document, 'projects');

export function projectDirectory(projectId: string): Directory {
  return new Directory(projectsDirectory, projectId);
}

export function ensureProjectsDirectoryExists(): void {
  if (!projectsDirectory.exists) {
    projectsDirectory.create({ intermediates: true });
  }
}

/**
 * Where Library folders live - one `<id>.json` per folder, a sibling of
 * `projects/` rather than a parent of it. A folder holds song ids, so it is
 * not where a song's audio lives and nesting the two would imply otherwise.
 */
export const setlistsDirectory = new Directory(Paths.document, 'setlists');

export function setlistFile(setlistId: string): File {
  return new File(setlistsDirectory, `${setlistId}.json`);
}

export function ensureSetlistsDirectoryExists(): void {
  if (!setlistsDirectory.exists) {
    setlistsDirectory.create({ intermediates: true });
  }
}
