import { Directory, Paths } from 'expo-file-system';

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
