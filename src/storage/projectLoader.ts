import { Directory, File } from 'expo-file-system';
import type { LibraryProjectEntry } from '@/store/projectsSlice';
import type { ProjectManifest } from '@/types/project';
import { getDemoProjectSource } from './demoProject';
import { foldToStereo } from './downmix';
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
  source: ProjectSource
): Promise<DecodedProject> {
  const { manifest } = source;

  const trackEntries = await Promise.all(
    manifest.tracks.map(async (track) => {
      const buffer = await context.decodeAudioData(source.resolveFile(track.file));
      return [track.id, foldToStereo(context, buffer)] as const;
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
