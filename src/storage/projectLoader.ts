import { Directory, File } from 'expo-file-system';
import type { LibraryProjectEntry } from '@/store/projectsSlice';
import type { ProjectManifest } from '@/types/project';
import { getDemoProjectSource } from './demoProject';
import { foldToStereo } from './downmix';
import { report, type ProgressReporter } from './progress';
import type { BaseAudioContext, DecodedProject, ProjectSource } from './types';

export async function readProjectManifest(directory: Directory): Promise<ProjectManifest> {
  const manifestFile = new File(directory, 'manifest.json');
  return manifestFile.json() as Promise<ProjectManifest>;
}

/** Builds a `ProjectSource` for a project that lives on the filesystem (e.g. imported by the user). */
export async function createFilesystemProjectSource(directory: Directory): Promise<ProjectSource> {
  const manifest = await readProjectManifest(directory);
  return {
    manifest,
    resolveFile: (file) => new File(directory, file).uri,
  };
}

/** Resolves a Library entry back to a decodable `ProjectSource`, regardless of where it lives. */
export async function getProjectSourceForEntry(entry: LibraryProjectEntry): Promise<ProjectSource> {
  if (entry.origin === 'bundled') {
    return getDemoProjectSource();
  }
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
