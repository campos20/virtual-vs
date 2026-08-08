export { getDemoLibraryEntry, getDemoProjectSource } from './demoProject';
export {
  createFilesystemProjectSource,
  decodeProjectAudio,
  getProjectSourceForEntry,
  readProjectManifest,
} from './projectLoader';
export { ensureProjectsDirectoryExists, projectDirectory, projectsDirectory } from './paths';
export type { AudioFileRef, DecodedProject, ProjectSource } from './types';
