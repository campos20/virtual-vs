export { getDemoLibraryEntry, getDemoProjectSource } from './demoProject';
export { listFilesystemProjects, loadProjectLibrary } from './projectLibrary';
export {
  addStemsToProject,
  createDraftProject,
  deleteProjectDirectory,
  removeStemFromProject,
  updateProjectMetadata,
  DRAFT_PROJECT_TITLE,
  type ProjectMetadataEdits,
} from './importProject';
export {
  createFilesystemProjectSource,
  decodeProjectAudio,
  getProjectSourceForEntry,
  readProjectManifest,
} from './projectLoader';
export { ensureProjectsDirectoryExists, projectDirectory, projectsDirectory } from './paths';
export type { AudioFileRef, DecodedProject, ProjectSource } from './types';
