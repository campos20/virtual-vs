import { Directory, File, FileMode, Paths } from 'expo-file-system';
import type { LibraryProjectEntry } from '@/store/projectsSlice';
import type { ProjectManifest } from '@/types/project';
import type { SetlistManifest } from '@/types/setlist';
import {
  BUNDLE_EXTENSION,
  BUNDLE_PREAMBLE_BYTES,
  BUNDLE_VERSION,
  BundleFormatError,
  bundleEntries,
  bundleSize,
  decodeBundleHeader,
  decodeBundlePreamble,
  encodeBundleHeader,
  type BundleHeader,
  type BundledProject,
} from './bundleFormat';
import { ensureProjectsDirectoryExists, projectDirectory } from './paths';
import { report, type ProgressReporter } from './progress';

/**
 * Reading and writing `.vvs` bundles - see bundleFormat.ts for the container.
 *
 * Everything here streams in fixed-size chunks. A project can run to hundreds
 * of megabytes, so nothing may hold a whole file (let alone a whole bundle)
 * in memory; the JS thread also has to be handed back between chunks, or a
 * long export would freeze the UI exactly the way a long import used to.
 */

/**
 * Bytes moved per read/write pair. Big enough that the per-chunk overhead
 * disappears against the copy itself, small enough that a chunk is never a
 * meaningful memory spike next to the audio buffers already decoded.
 */
const CHUNK_BYTES = 1024 * 1024;

/** How often to hand the thread back, in chunks. Every chunk would cost more in yields than it saves. */
const YIELD_EVERY_CHUNKS = 8;

export interface BundleContents {
  projects: LibraryProjectEntry[];
  folders: SetlistManifest[];
}

export interface ImportedBundle {
  /** Projects written to disk by this import. */
  projects: LibraryProjectEntry[];
  /** Folders the bundle carried, for the caller to merge into the library. */
  folders: SetlistManifest[];
  /** Ids already present locally, left untouched rather than overwritten. */
  skippedProjectIds: string[];
}

/** Filename for a bundle of `label`, e.g. "Sunday Set" -> "sunday-set.vvs". */
export function bundleFileName(label: string): string {
  const slug =
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'virtual-vs';
  return `${slug}.${BUNDLE_EXTENSION}`;
}

/** Every distinct file a project's manifest references, in manifest order. */
function projectFileNames(manifest: ProjectManifest): string[] {
  const names = manifest.tracks.map((track) => track.file);
  if (manifest.pad) names.push(manifest.pad.file);
  // Two tracks pointing at one file would otherwise be stored twice.
  return [...new Set(names)];
}

function requireSourceDir(project: LibraryProjectEntry): Directory {
  if (!project.sourceDir) {
    throw new BundleFormatError(`"${project.title}" has no folder on this device to export.`);
  }
  return new Directory(project.sourceDir);
}

/**
 * Describes what a bundle of `contents` would contain, without writing
 * anything - so the UI can show a size before starting a multi-minute write
 * onto a phone that may not have room for it.
 */
export function planBundle(contents: BundleContents, appVersion?: string): BundleHeader {
  const projects: BundledProject[] = contents.projects.map((project) => {
    const directory = requireSourceDir(project);
    const files = projectFileNames(project).map((name) => {
      const file = new File(directory, name);
      if (!file.exists) {
        throw new BundleFormatError(`"${project.title}" is missing its file ${name}.`);
      }
      return { name, size: file.size ?? 0 };
    });
    // The entry carries store-only fields (origin, sourceDir) that mean
    // nothing on another device - only the manifest travels.
    const { origin: _origin, sourceDir: _sourceDir, ...manifest } = project;
    return { manifest, files };
  });

  return {
    format: 'virtual-vs-bundle',
    version: BUNDLE_VERSION,
    app: appVersion,
    folders: contents.folders,
    projects,
  };
}

/** Bytes a bundle of `contents` will occupy. */
export function plannedBundleSize(contents: BundleContents): number {
  return bundleSize(planBundle(contents));
}

/**
 * Copies `size` bytes from `from` (at its current offset) into `to`, a chunk
 * at a time, yielding periodically so the UI keeps painting.
 */
async function streamBytes(
  from: { readBytes(length: number): Uint8Array },
  to: { writeBytes(bytes: Uint8Array): void },
  size: number,
  onChunk?: (copied: number) => void
): Promise<void> {
  let copied = 0;
  let sinceYield = 0;

  while (copied < size) {
    const chunk = from.readBytes(Math.min(CHUNK_BYTES, size - copied));
    if (chunk.length === 0) {
      throw new BundleFormatError('The file ended sooner than its index said it would.');
    }
    to.writeBytes(chunk);
    copied += chunk.length;
    onChunk?.(copied);

    sinceYield += 1;
    if (sinceYield >= YIELD_EVERY_CHUNKS) {
      sinceYield = 0;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

/**
 * Writes `contents` into `destination` as a bundle.
 *
 * The header is written first and never revised, which is why every file's
 * size is measured up front: a bundle whose index disagrees with its payload
 * is unreadable, and rewriting the header afterwards would mean the file is
 * briefly in exactly that state.
 */
export async function writeBundle(
  contents: BundleContents,
  destination: File,
  onProgress?: ProgressReporter,
  appVersion?: string
): Promise<File> {
  const header = planBundle(contents, appVersion);

  if (destination.exists) destination.delete();
  destination.create({ intermediates: true });

  const out = destination.open(FileMode.Truncate);
  try {
    out.writeBytes(encodeBundleHeader(header));

    const total = header.projects.reduce((sum, project) => sum + project.files.length, 0);
    let done = 0;

    for (const [index, project] of header.projects.entries()) {
      const directory = requireSourceDir(contents.projects[index]);

      for (const file of project.files) {
        done += 1;
        await report(onProgress, {
          phase: 'exporting',
          name: file.name,
          current: done,
          total,
        });

        const source = new File(directory, file.name).open(FileMode.ReadOnly);
        try {
          await streamBytes(source, out, file.size);
        } finally {
          source.close();
        }
      }
    }
  } finally {
    out.close();
  }

  return destination;
}

/** Writes a bundle into the cache directory, where it can be handed to the share sheet. */
export async function writeBundleToCache(
  contents: BundleContents,
  label: string,
  onProgress?: ProgressReporter,
  appVersion?: string
): Promise<File> {
  const destination = new File(Paths.cache, bundleFileName(label));
  return writeBundle(contents, destination, onProgress, appVersion);
}

/**
 * Reads a bundle's index without touching its payload - enough to show what
 * is inside before committing to importing it.
 */
export function readBundleHeader(file: File): { header: BundleHeader; payloadOffset: number } {
  const handle = file.open(FileMode.ReadOnly);
  try {
    const { headerLength } = decodeBundlePreamble(handle.readBytes(BUNDLE_PREAMBLE_BYTES));

    // decodeBundlePreamble already refuses an absurd length (MAX_HEADER_BYTES),
    // but the file itself is the tighter bound: a header can never run past the
    // end of the bundle carrying it. Checking here means a truncated or
    // mislabelled file is rejected before any large read is attempted, rather
    // than after.
    const fileSize = file.size ?? 0;
    if (fileSize > 0 && BUNDLE_PREAMBLE_BYTES + headerLength > fileSize) {
      throw new BundleFormatError("This bundle's index is damaged and can't be read.");
    }

    const header = decodeBundleHeader(handle.readBytes(headerLength));
    return { header, payloadOffset: BUNDLE_PREAMBLE_BYTES + headerLength };
  } finally {
    handle.close();
  }
}

/**
 * Whether a directory already holds a project the Library can actually see.
 *
 * Deliberately the same test `listFilesystemProjects` applies - a readable
 * manifest - and not merely "the directory is there". An import that died
 * partway leaves a directory with audio but no manifest yet (the manifest is
 * written last, on purpose); treating that as an existing project would make
 * it permanently invisible *and* permanently un-importable, since every later
 * attempt would skip it too.
 */
function holdsVisibleProject(directory: Directory): boolean {
  const manifest = new File(directory, 'manifest.json');
  if (!manifest.exists) return false;
  try {
    JSON.parse(manifest.textSync());
    return true;
  } catch {
    return false;
  }
}

/**
 * Unpacks a bundle into the projects directory.
 *
 * A project whose id already exists is left alone rather than overwritten:
 * re-importing your own backup is then a no-op instead of silently replacing
 * a mix you have since changed, and a bundle from someone else can never
 * clobber a song of yours that happens to share an id.
 *
 * Each project's `manifest.json` is written *last*, after its audio. A scan
 * skips a folder it can't read a manifest from (see projectLibrary.ts), so an
 * import interrupted halfway leaves an invisible directory rather than a
 * project with missing stems.
 */
export async function importBundle(
  file: File,
  onProgress?: ProgressReporter
): Promise<ImportedBundle> {
  ensureProjectsDirectoryExists();

  const { header, payloadOffset } = readBundleHeader(file);
  const entries = bundleEntries(header, payloadOffset);
  // Keyed lookup rather than a scan per file: a bundle of a whole set can hold
  // hundreds of stems, and a find() inside the loop makes unpacking quadratic
  // in that count. NUL can't occur in either half, so the key is unambiguous.
  const entriesByFile = new Map(
    entries.map((entry) => [`${entry.projectId}\u0000${entry.name}`, entry])
  );

  const imported: LibraryProjectEntry[] = [];
  const skippedProjectIds: string[] = [];

  const handle = file.open(FileMode.ReadOnly);
  try {
    let done = 0;

    for (const project of header.projects) {
      const id = project.manifest.id;
      const directory = projectDirectory(id);

      if (holdsVisibleProject(directory)) {
        skippedProjectIds.push(id);
        done += project.files.length;
        continue;
      }

      // Either brand new, or the leftovers of an import that died partway -
      // in which case its files are overwritten below and it finally gets the
      // manifest that makes it real.
      if (!directory.exists) directory.create({ intermediates: true });

      for (const file of project.files) {
        const entry = entriesByFile.get(`${id}\u0000${file.name}`)!;
        done += 1;
        await report(onProgress, {
          phase: 'importing',
          name: file.name,
          current: done,
          total: entries.length,
        });

        const target = new File(directory, file.name);
        target.create({ overwrite: true });
        const out = target.open(FileMode.Truncate);
        try {
          handle.offset = entry.offset;
          await streamBytes(handle, out, entry.size);
        } finally {
          out.close();
        }
      }

      new File(directory, 'manifest.json').write(JSON.stringify(project.manifest, null, 2));
      imported.push({ ...project.manifest, origin: 'filesystem', sourceDir: directory.uri });
    }
  } finally {
    handle.close();
  }

  return { projects: imported, folders: header.folders, skippedProjectIds };
}
