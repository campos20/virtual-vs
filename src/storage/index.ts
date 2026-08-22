export { getDemoLibraryEntry, getDemoProjectSource } from './demoProject';
export { listFilesystemProjects, loadProjectLibrary } from './projectLibrary';
export {
  addStemsToProject,
  createDraftProject,
  deleteProjectDirectory,
  patchProjectManifest,
  removeStemFromProject,
  renameStemInProject,
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
export {
  createSetlist,
  deleteSetlist,
  listSetlists,
  writeSetlist,
  DRAFT_FOLDER_NAME,
} from './setlistLibrary';
export {
  ensureProjectsDirectoryExists,
  ensureSetlistsDirectoryExists,
  projectDirectory,
  projectsDirectory,
  setlistFile,
  setlistsDirectory,
} from './paths';
export type { AudioFileRef, DecodedProject, ProjectSource } from './types';
