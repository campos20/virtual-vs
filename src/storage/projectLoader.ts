import { Directory, File } from 'expo-file-system';
import type { LibraryProjectEntry } from '@/store/projectsSlice';
import type { ProjectManifest } from '@/types/project';
import { foldToStereo } from './downmix';
import { report, type ProgressReporter } from './progress';
import type { BaseAudioContext, DecodedProject, ProjectSource } from './types';

/** Short random id, unique enough within one project's marker list. */
function generateSectionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Backfills a stable `id` onto any section that doesn't have one.
 *
 * `SectionManifest.id` was added after `sections` itself: the README's
 * documented manifest.json schema (and every manifest written before this
 * field existed) only guarantees `{ name, startSec }`. Without this, a
 * legacy/hand-authored section would get an `undefined` React key and
 * `undefined` id in the Markers UI - and since MarkersDrawer's remove button
 * filters by `id`, removing *any* one legacy marker would remove *every*
 * legacy marker sharing that same `undefined` id. Persisting the fix once,
 * here, means ids are stable from the very first read onward rather than
 * being silently re-derived (and drifting) on every subsequent read.
 */
function normalizeSections(directory: Directory, manifest: ProjectManifest): ProjectManifest {
  const sections = manifest.sections ?? [];
  const needsBackfill = sections.some((section) => !section.id);
  if (!needsBackfill) {
    // Nothing to fix, so nothing to write - avoids an unnecessary disk write
    // on every ordinary project load. Only defaults the in-memory shape for
    // the (equally legacy) case of `sections` being absent altogether.
    return manifest.sections ? manifest : { ...manifest, sections };
  }

  const normalized: ProjectManifest = {
    ...manifest,
    sections: sections.map((section) => (section.id ? section : { ...section, id: generateSectionId() })),
  };
  new File(directory, 'manifest.json').write(JSON.stringify(normalized, null, 2));
  return normalized;
}

export async function readProjectManifest(directory: Directory): Promise<ProjectManifest> {
  const manifestFile = new File(directory, 'manifest.json');
  const manifest = (await manifestFile.json()) as ProjectManifest;
  return normalizeSections(directory, manifest);
}

/** Builds a `ProjectSource` for a project that lives on the filesystem (e.g. imported by the user). */
export async function createFilesystemProjectSource(directory: Directory): Promise<ProjectSource> {
  const manifest = await readProjectManifest(directory);
  return {
    manifest,
    resolveFile: (file) => new File(directory, file).uri,
  };
}

/** Resolves a Library entry back to a decodable `ProjectSource`. */
export async function getProjectSourceForEntry(entry: LibraryProjectEntry): Promise<ProjectSource> {
  if (!entry.sourceDir) {
    throw new Error(`Filesystem project "${entry.id}" is missing its sourceDir`);
  }
  return createFilesystemProjectSource(new Directory(entry.sourceDir));
}

/**
 * Decodes every stem (and the pad, if present) referenced by a project's
 * manifest through the engine's `AudioContext`, so they land at the
 * context's sample rate. Run this once per project load, then hand the
 * result to `AudioEngine.loadProject()` to build the node graph.
 */
export async function decodeProjectAudio(
  context: BaseAudioContext,
  source: ProjectSource,
  onProgress?: ProgressReporter
): Promise<DecodedProject> {
  const { manifest } = source;

  // Decoding stays parallel - it's native work off the JS thread, and running
  // stems one at a time to report finer progress would make the wait longer
  // for the sake of a nicer label. Progress is reported as each one lands.
  let done = 0;
  const total = manifest.tracks.length;
  await report(onProgress, { phase: 'decoding', current: 0, total });

  const trackEntries = await Promise.all(
    manifest.tracks.map(async (track) => {
      const buffer = await context.decodeAudioData(source.resolveFile(track.file));
      const folded = foldToStereo(context, buffer);
      done += 1;
      onProgress?.({ phase: 'decoding', name: track.name, current: done, total });
      return [track.id, folded] as const;
    })
  );

  const padBuffer = manifest.pad
    ? foldToStereo(context, await context.decodeAudioData(source.resolveFile(manifest.pad.file)))
    : undefined;

  return {
    manifest,
    trackBuffers: Object.fromEntries(trackEntries),
    padBuffer,
  };
}
