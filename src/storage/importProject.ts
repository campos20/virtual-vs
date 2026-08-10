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
// What *is* implemented here: building a project directly from individually
// (or multiply-) picked audio files, with no manifest.json of their own -
// see createProjectFromStems() below.

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

export interface NewProjectFromStemsOptions {
  title: string;
  bpm: number;
  /** Files as returned by `expo-document-picker`'s `getDocumentAsync({ multiple: true })`. */
  files: DocumentPickerAsset[];
}

/**
 * Builds a project directly from individually-picked audio files: no
 * pre-packaged manifest.json, no zip. Copies each file into its own project
 * folder under `projectsDirectory`, writes a generated manifest.json next to
 * them (one track per file, default `main` bus and unity gain), and returns
 * a filesystem-origin Library entry ready to `dispatch(projectAdded(...))`.
 */
export async function createProjectFromStems({
  title,
  bpm,
  files,
}: NewProjectFromStemsOptions): Promise<LibraryProjectEntry> {
  if (files.length === 0) {
    throw new Error('Select at least one audio file.');
  }

  const id = `${slugify(title)}-${Date.now().toString(36)}`;
  const directory = projectDirectory(id);
  directory.create({ intermediates: true });

  const usedFileNames = new Set<string>();
  const usedTrackIds = new Set<string>();
  const tracks: TrackManifest[] = [];

  for (const asset of files) {
    const fileName = dedupe(asset.name, usedFileNames);
    const destination = new File(directory, fileName);
    const source = new File(asset.uri);
    await source.copy(destination);

    tracks.push({
      id: dedupe(slugify(stripExtension(asset.name)), usedTrackIds),
      name: stripExtension(asset.name),
      file: fileName,
      gain: 1,
      bus: 'main',
    });
  }

  const manifest: ProjectManifest = {
    id,
    title,
    bpm,
    key: '',
    countInBars: 1,
    tracks,
    sections: [],
  };

  new File(directory, 'manifest.json').write(JSON.stringify(manifest, null, 2));

  return { ...manifest, origin: 'filesystem', sourceDir: directory.uri };
}

export interface ProjectMetadataEdits {
  title: string;
  bpm: number;
  key: string;
  countInBars: number;
}

/**
 * Rewrites a filesystem project's manifest.json with edited top-level
 * metadata (title/bpm/key/count-in), preserving its tracks/sections/pad.
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
  new File(directory, 'manifest.json').write(JSON.stringify(updated, null, 2));
  return updated;
}
