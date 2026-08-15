import { Directory, File } from 'expo-file-system';
import type { DocumentPickerAsset } from 'expo-document-picker';
import type { LibraryProjectEntry } from '@/store/projectsSlice';
import type { ProjectManifest, TrackManifest } from '@/types/project';
import { projectDirectory } from './paths';
import { readProjectManifest } from './projectLoader';

// Full zip project import/export (a pre-packaged manifest.json + stems,
// picked and extracted as one archive) is still out of scope for phase 1 -
// see AGENTS.md. `Directory.pickDirectoryAsync()` (expo-file-system v57) is
// also worth evaluating later as an alternative to zip import, letting the
// user point straight at a folder of stems without packaging (at the cost of
// the iOS access grant only lasting the current app session).
//
// What *is* implemented here: creating an empty project and adding/removing
// individually-picked audio files to it, generating the manifest.json as we
// go - see createDraftProject() and addStemsToProject() below.

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** Appends a short suffix until `candidate` is absent from `used`, then reserves it. */
function dedupe(candidate: string, used: Set<string>): string {
  let unique = candidate;
  let n = 2;
  while (used.has(unique)) {
    unique = `${candidate}-${n}`;
    n += 1;
  }
  used.add(unique);
  return unique;
}

/** Title a freshly created draft carries until the user names it. */
export const DRAFT_PROJECT_TITLE = 'Untitled';

/** Names already taken inside a project folder, so added stems never collide with existing ones. */
function existingNames(manifest: ProjectManifest): {
  files: Set<string>;
  trackIds: Set<string>;
} {
  return {
    files: new Set(manifest.tracks.map((t) => t.file)),
    trackIds: new Set(manifest.tracks.map((t) => t.id)),
  };
}

/** Copies `files` into `directory`, returning the track entries describing them. */
async function copyStems(
  directory: Directory,
  files: DocumentPickerAsset[],
  usedFileNames: Set<string>,
  usedTrackIds: Set<string>
): Promise<TrackManifest[]> {
  const tracks: TrackManifest[] = [];
  for (const asset of files) {
    const fileName = dedupe(asset.name, usedFileNames);
    await new File(asset.uri).copy(new File(directory, fileName));
    tracks.push({
      id: dedupe(slugify(stripExtension(asset.name)), usedTrackIds),
      name: stripExtension(asset.name),
      file: fileName,
      gain: 1,
      bus: 'main',
    });
  }
  return tracks;
}

/**
 * Creates an empty project folder + manifest and returns its Library entry.
 *
 * There is no separate "new project" flow: creating simply means opening a
 * project that has no stems yet, which the project screen shows in edit mode.
 * Stems are then added through `addStemsToProject`, exactly as they are for a
 * project that already existed.
 */
export async function createDraftProject(): Promise<LibraryProjectEntry> {
  const id = `${slugify(DRAFT_PROJECT_TITLE)}-${Date.now().toString(36)}`;
  const directory = projectDirectory(id);
  directory.create({ intermediates: true });

  const manifest: ProjectManifest = {
    id,
    title: DRAFT_PROJECT_TITLE,
    key: '',
    tracks: [],
    sections: [],
  };

  new File(directory, 'manifest.json').write(JSON.stringify(manifest, null, 2));

  return { ...manifest, origin: 'filesystem', sourceDir: directory.uri };
}

/**
 * Deletes a project's folder outright. Used to discard a draft the user backed
 * out of before adding any stems, so abandoning "+ New" doesn't leave empty
 * projects piling up in the Library.
 */
export function deleteProjectDirectory(sourceDir: string): void {
  const directory = new Directory(sourceDir);
  if (directory.exists) directory.delete();
}

/**
 * Copies additional stems into an existing project folder and appends them to
 * its manifest, de-duplicating against the files/track ids already in there.
 * Returns the rewritten manifest.
 */
export async function addStemsToProject(
  sourceDir: string,
  files: DocumentPickerAsset[]
): Promise<ProjectManifest> {
  const directory = new Directory(sourceDir);
  const manifest = await readProjectManifest(directory);
  const used = existingNames(manifest);

  const added = await copyStems(directory, files, used.files, used.trackIds);
  const updated: ProjectManifest = { ...manifest, tracks: [...manifest.tracks, ...added] };

  new File(directory, 'manifest.json').write(JSON.stringify(updated, null, 2));
  return updated;
}

/**
 * Drops a stem from a project: removes it from the manifest and deletes the
 * copy this app made inside the project folder. The user's original file
 * elsewhere on the device is untouched - we only ever own our own copy.
 */
export async function removeStemFromProject(
  sourceDir: string,
  trackId: string
): Promise<ProjectManifest> {
  const directory = new Directory(sourceDir);
  const manifest = await readProjectManifest(directory);

  const track = manifest.tracks.find((t) => t.id === trackId);
  if (!track) return manifest;

  const updated: ProjectManifest = {
    ...manifest,
    tracks: manifest.tracks.filter((t) => t.id !== trackId),
  };
  new File(directory, 'manifest.json').write(JSON.stringify(updated, null, 2));

  // Manifest first, file second: a stale file with no manifest entry is
  // harmless, whereas a manifest pointing at a deleted file fails to load.
  const stem = new File(directory, track.file);
  if (stem.exists) stem.delete();

  return updated;
}

/**
 * Merges `changes` into a project's manifest.json on disk.
 *
 * This is how mixer state survives the app closing: the manifest is the
 * project's configuration file, so committed volume/bus/mute/solo and the
 * click toggle live there next to the stems they describe, rather than in a
 * separate database that could drift out of sync with them.
 */
export async function patchProjectManifest(
  sourceDir: string,
  changes: Partial<ProjectManifest>
): Promise<ProjectManifest> {
  const directory = new Directory(sourceDir);
  const manifest = await readProjectManifest(directory);
  const updated: ProjectManifest = { ...manifest, ...changes };
  new File(directory, 'manifest.json').write(JSON.stringify(updated, null, 2));
  return updated;
}

export interface ProjectMetadataEdits {
  title: string;
  /** `undefined` clears the tempo, which removes the project's click entirely. */
  bpm?: number;
  key: string;
}

/**
 * Rewrites a filesystem project's manifest.json with edited top-level
 * metadata (title/bpm/key), preserving its tracks/sections/pad.
 * Bundled projects have no manifest.json to write back to and can't be
 * edited this way - see LibraryScreen, which only offers editing for
 * `origin: 'filesystem'` entries.
 */
export async function updateProjectMetadata(
  sourceDir: string,
  edits: ProjectMetadataEdits
): Promise<ProjectManifest> {
  const directory = new Directory(sourceDir);
  const manifest = await readProjectManifest(directory);
  const updated: ProjectManifest = { ...manifest, ...edits };
  // Clearing the tempo field has to actually drop it, otherwise the spread
  // would leave the project's previous bpm (and its click) in place.
  if (edits.bpm === undefined) delete updated.bpm;
  new File(directory, 'manifest.json').write(JSON.stringify(updated, null, 2));
  return updated;
}
