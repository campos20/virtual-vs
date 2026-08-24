import { File, Paths } from 'expo-file-system';
import type { LibraryProjectEntry } from '@/store/projectsSlice';
import type { SetlistManifest } from '@/types/setlist';
import type { ProgressUpdate } from './progress';
import {
  bundleFileName,
  importBundle,
  planBundle,
  plannedBundleSize,
  readBundleHeader,
  writeBundle,
} from './bundle';

/**
 * An in-memory stand-in for the `File`/`Directory` surface bundle.ts uses.
 *
 * The property under test is that bytes come out the far end unchanged -
 * across the chunk boundary, across a seek, and through a header written
 * before any of them. A map of paths to byte arrays models that exactly,
 * without needing a device.
 */
jest.mock('expo-file-system', () => {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>();
  /** Every mutation in order, so tests can assert what happened before what. */
  const log: string[] = [];

  const join = (base: string, name?: string) =>
    name === undefined ? base : `${base.replace(/\/$/, '')}/${name}`;

  const uriOf = (value: unknown) =>
    typeof value === 'string' ? value : ((value as { uri: string }).uri ?? '');

  const FileMode = { ReadWrite: 'rw', ReadOnly: 'r', WriteOnly: 'w', Append: 'wa', Truncate: 'wt' };

  class Directory {
    uri: string;
    constructor(base: unknown, name?: string) {
      this.uri = join(uriOf(base), name);
    }
    get exists() {
      return directories.has(this.uri);
    }
    create() {
      directories.add(this.uri);
      log.push(`mkdir ${this.uri}`);
    }
    list() {
      return [];
    }
  }

  class File {
    uri: string;
    constructor(base: unknown, name?: string) {
      this.uri = join(uriOf(base), name);
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.length ?? 0;
    }
    create() {
      if (!files.has(this.uri)) files.set(this.uri, new Uint8Array(0));
    }
    delete() {
      files.delete(this.uri);
    }
    write(text: string) {
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
      files.set(this.uri, bytes);
      log.push(`write ${this.uri}`);
    }
    textSync() {
      const bytes = files.get(this.uri);
      if (!bytes) throw new Error(`no such file: ${this.uri}`);
      return String.fromCharCode(...bytes);
    }
    open(mode: string) {
      const path = this.uri;
      if (mode === FileMode.Truncate) files.set(path, new Uint8Array(0));
      let offset = 0;
      return {
        get offset() {
          return offset;
        },
        set offset(next: number) {
          offset = next;
        },
        readBytes(length: number) {
          const bytes = files.get(path) ?? new Uint8Array(0);
          const slice = bytes.slice(offset, offset + length);
          offset += slice.length;
          return slice;
        },
        writeBytes(bytes: Uint8Array) {
          const current = files.get(path) ?? new Uint8Array(0);
          const next = new Uint8Array(current.length + bytes.length);
          next.set(current);
          next.set(bytes, current.length);
          files.set(path, next);
          offset = next.length;
          log.push(`stream ${path}`);
        },
        close() {},
      };
    }
  }

  return {
    File,
    Directory,
    FileMode,
    Paths: { document: 'file:///document', cache: 'file:///cache' },
    __disk: { files, directories, log },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const disk = require('expo-file-system').__disk as {
  files: Map<string, Uint8Array>;
  directories: Set<string>;
  log: string[];
};

/**
 * Byte-exact comparison that stays fast on megabyte arrays. Jest's own deep
 * equality walks a typed array element by element, which turns the
 * across-a-chunk-boundary test into a five-second one; this narrows to a
 * readable failure only when the bytes actually differ.
 */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

function expectSameBytes(actual: Uint8Array | undefined, expected: Uint8Array) {
  expect(actual).toBeDefined();
  expect(actual!.length).toBe(expected.length);

  const at = firstDifference(actual!, expected);
  if (at === -1) return;
  throw new Error(
    `bytes differ at ${at}: expected ${expected[at]}, got ${actual![at]} (length ${expected.length})`
  );
}

/** Recognisable, position-dependent content, so a mis-seek can't pass unnoticed. */
function stemBytes(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (seed * 31 + i * 7) % 256;
  return bytes;
}

function putStem(projectId: string, name: string, size: number, seed: number): Uint8Array {
  const bytes = stemBytes(size, seed);
  disk.files.set(`file:///document/projects/${projectId}/${name}`, bytes);
  disk.directories.add(`file:///document/projects/${projectId}`);
  return bytes;
}

/**
 * Gives a project the manifest that makes it visible to the Library - and so
 * "already imported" as far as importBundle is concerned. A directory without
 * one is the wreckage of an interrupted import, not a project.
 */
function putManifest(projectId: string) {
  new File(`file:///document/projects/${projectId}`, 'manifest.json').write(
    JSON.stringify({ id: projectId, title: projectId, key: '', tracks: [], sections: [] })
  );
}

function project(id: string, files: string[], title = id): LibraryProjectEntry {
  return {
    id,
    title,
    bpm: 120,
    key: 'C',
    tracks: files.map((file, index) => ({
      id: `t${index}`,
      name: file,
      file,
      gain: 0.8,
      bus: 'main' as const,
    })),
    sections: [],
    origin: 'filesystem',
    sourceDir: `file:///document/projects/${id}`,
  };
}

function folder(id: string, songs: string[]): SetlistManifest {
  return { id, name: id, songs, advance: 'manual', padBetween: false };
}

/** Forgets the projects directory, modelling importing onto a different phone. */
function wipeLibrary() {
  for (const path of [...disk.files.keys()]) {
    if (path.startsWith('file:///document/projects/')) disk.files.delete(path);
  }
  for (const dir of [...disk.directories]) {
    if (dir.startsWith('file:///document/projects/')) disk.directories.delete(dir);
  }
}

beforeEach(() => {
  disk.files.clear();
  disk.directories.clear();
  disk.log.length = 0;
});

describe('bundleFileName', () => {
  it('slugs the label', () => {
    expect(bundleFileName('Sunday Morning Set')).toBe('sunday-morning-set.vvs');
  });

  it('falls back when the label has nothing sluggable in it', () => {
    expect(bundleFileName('...')).toBe('virtual-vs.vvs');
  });
});

describe('planBundle', () => {
  it('drops store-only fields, so nothing device-specific travels', () => {
    putStem('song', 'bass.wav', 10, 1);

    const [bundled] = planBundle({ projects: [project('song', ['bass.wav'])], folders: [] }).projects;

    expect(bundled.manifest).not.toHaveProperty('origin');
    expect(bundled.manifest).not.toHaveProperty('sourceDir');
    expect(bundled.manifest.id).toBe('song');
  });

  it('stores a file referenced by two tracks only once', () => {
    putStem('song', 'shared.wav', 10, 1);
    const entry = project('song', ['shared.wav', 'shared.wav']);

    const [bundled] = planBundle({ projects: [entry], folders: [] }).projects;

    expect(bundled.files).toEqual([{ name: 'shared.wav', size: 10 }]);
  });

  it('refuses a project whose audio is missing rather than writing a broken bundle', () => {
    expect(() => planBundle({ projects: [project('song', ['gone.wav'])], folders: [] })).toThrow(
      /missing its file gone.wav/
    );
  });

  it('refuses a project with no folder on this device', () => {
    const entry = { ...project('song', []), sourceDir: undefined };

    expect(() => planBundle({ projects: [entry], folders: [] })).toThrow(/no folder on this device/);
  });
});

describe('writeBundle', () => {
  it('reports the size it will take before anything is written', async () => {
    putStem('song', 'bass.wav', 500, 1);
    const contents = { projects: [project('song', ['bass.wav'])], folders: [] };

    const predicted = plannedBundleSize(contents);
    const written = await writeBundle(contents, new File(Paths.cache, 'out.vvs'));

    expect(written.size).toBe(predicted);
  });

  it('reports progress per file', async () => {
    putStem('song', 'bass.wav', 10, 1);
    putStem('song', 'keys.wav', 10, 2);
    const updates: ProgressUpdate[] = [];

    await writeBundle(
      { projects: [project('song', ['bass.wav', 'keys.wav'])], folders: [] },
      new File(Paths.cache, 'out.vvs'),
      (update) => updates.push(update)
    );

    expect(updates).toEqual([
      { phase: 'exporting', name: 'bass.wav', current: 1, total: 2 },
      { phase: 'exporting', name: 'keys.wav', current: 2, total: 2 },
    ]);
  });

  it('overwrites a bundle left from a previous export instead of appending to it', async () => {
    putStem('song', 'bass.wav', 100, 1);
    const contents = { projects: [project('song', ['bass.wav'])], folders: [] };
    const destination = new File(Paths.cache, 'out.vvs');

    await writeBundle(contents, destination);
    const first = destination.size;
    await writeBundle(contents, destination);

    expect(destination.size).toBe(first);
  });
});

describe('round trip', () => {
  it('restores every stem byte for byte, with its manifest and folder', async () => {
    const bass = putStem('sunday-a', 'bass.wav', 300, 1);
    const keys = putStem('sunday-a', 'keys.wav', 120, 2);
    const vox = putStem('sunday-b', 'vox.wav', 90, 3);
    const contents = {
      projects: [project('sunday-a', ['bass.wav', 'keys.wav'], 'Coração'), project('sunday-b', ['vox.wav'])],
      folders: [folder('sunday', ['sunday-a', 'sunday-b'])],
    };

    const bundle = await writeBundle(contents, new File(Paths.cache, 'out.vvs'));
    wipeLibrary();
    const result = await importBundle(bundle);

    expectSameBytes(disk.files.get('file:///document/projects/sunday-a/bass.wav'), bass);
    expectSameBytes(disk.files.get('file:///document/projects/sunday-a/keys.wav'), keys);
    expectSameBytes(disk.files.get('file:///document/projects/sunday-b/vox.wav'), vox);
    expect(result.projects.map((p) => p.title)).toEqual(['Coração', 'sunday-b']);
    expect(result.folders).toEqual([folder('sunday', ['sunday-a', 'sunday-b'])]);
  });

  // The chunked copy is the whole reason this streams; a file that fits in one
  // chunk would never exercise the loop or the seek back to the next file.
  it('survives files larger than one chunk', async () => {
    const big = putStem('song', 'big.wav', 1024 * 1024 + 4321, 7);
    const after = putStem('song', 'after.wav', 64, 9);

    const bundle = await writeBundle(
      { projects: [project('song', ['big.wav', 'after.wav'])], folders: [] },
      new File(Paths.cache, 'out.vvs')
    );
    wipeLibrary();
    await importBundle(bundle);

    expectSameBytes(disk.files.get('file:///document/projects/song/big.wav'), big);
    // The file after the big one proves the reader resumed at the right offset.
    expectSameBytes(disk.files.get('file:///document/projects/song/after.wav'), after);
  });

  it('reads the index without unpacking anything', async () => {
    putStem('song', 'bass.wav', 50, 1);
    const bundle = await writeBundle(
      { projects: [project('song', ['bass.wav'], 'My Song')], folders: [folder('set', ['song'])] },
      new File(Paths.cache, 'out.vvs')
    );
    wipeLibrary();

    const { header } = readBundleHeader(bundle);

    expect(header.projects[0].manifest.title).toBe('My Song');
    expect(header.folders[0].id).toBe('set');
    expect(disk.files.has('file:///document/projects/song/bass.wav')).toBe(false);
  });
});

describe('importBundle', () => {
  it('leaves an existing project alone and says so, so re-importing a backup is a no-op', async () => {
    const original = putStem('song', 'bass.wav', 40, 1);
    const bundle = await writeBundle(
      { projects: [project('song', ['bass.wav'])], folders: [] },
      new File(Paths.cache, 'out.vvs')
    );
    putManifest('song');
    // The local copy has since been changed - importing must not revert it.
    const edited = stemBytes(40, 99);
    disk.files.set('file:///document/projects/song/bass.wav', edited);

    const result = await importBundle(bundle);

    expect(result.skippedProjectIds).toEqual(['song']);
    expect(result.projects).toEqual([]);
    expectSameBytes(disk.files.get('file:///document/projects/song/bass.wav'), edited);
    expect(firstDifference(disk.files.get('file:///document/projects/song/bass.wav')!, original)).not.toBe(-1);
  });

  /**
   * The manifest is written last, so a dead import leaves a directory holding
   * audio and nothing else. Treating that as "already imported" would make the
   * project invisible to the Library *and* skip it on every future attempt -
   * permanently stranded, with no way to get it back but a manual delete.
   */
  it('finishes an import that died before its manifest was written', async () => {
    const bass = putStem('song', 'bass.wav', 40, 1);
    const bundle = await writeBundle(
      { projects: [project('song', ['bass.wav'])], folders: [] },
      new File(Paths.cache, 'out.vvs')
    );
    wipeLibrary();
    // What an interrupted import leaves behind: the directory and a partial
    // file, but no manifest.json.
    disk.directories.add('file:///document/projects/song');
    disk.files.set('file:///document/projects/song/bass.wav', new Uint8Array(7));

    const result = await importBundle(bundle);

    expect(result.skippedProjectIds).toEqual([]);
    expect(result.projects.map((p) => p.id)).toEqual(['song']);
    expectSameBytes(disk.files.get('file:///document/projects/song/bass.wav'), bass);
    expect(disk.files.has('file:///document/projects/song/manifest.json')).toBe(true);
  });

  it('re-imports over a manifest that is there but unreadable', async () => {
    putStem('song', 'bass.wav', 40, 1);
    const bundle = await writeBundle(
      { projects: [project('song', ['bass.wav'], 'Real Title')], folders: [] },
      new File(Paths.cache, 'out.vvs')
    );
    wipeLibrary();
    disk.directories.add('file:///document/projects/song');
    new File('file:///document/projects/song', 'manifest.json').write('{ truncated');

    const result = await importBundle(bundle);

    // The Library can't see a project whose manifest won't parse either, so
    // skipping it here would strand it the same way.
    expect(result.projects.map((p) => p.title)).toEqual(['Real Title']);
  });

  it('still returns the folders when every project was already there', async () => {
    putStem('song', 'bass.wav', 40, 1);
    const bundle = await writeBundle(
      { projects: [project('song', ['bass.wav'])], folders: [folder('set', ['song'])] },
      new File(Paths.cache, 'out.vvs')
    );
    putManifest('song');

    const result = await importBundle(bundle);

    // The point of importing a shared set you already own the songs of.
    expect(result.folders[0].songs).toEqual(['song']);
  });

  // A scan skips a directory it can't read a manifest from, so an import that
  // dies halfway leaves an invisible folder rather than a project with holes.
  it('writes the manifest only after the audio it describes', async () => {
    putStem('song', 'bass.wav', 40, 1);
    const bundle = await writeBundle(
      { projects: [project('song', ['bass.wav'])], folders: [] },
      new File(Paths.cache, 'out.vvs')
    );
    wipeLibrary();
    disk.log.length = 0;

    await importBundle(bundle);

    const stemWrite = disk.log.findIndex((line) => line.includes('projects/song/bass.wav'));
    const manifestWrite = disk.log.findIndex((line) => line.includes('projects/song/manifest.json'));
    expect(stemWrite).toBeGreaterThanOrEqual(0);
    expect(manifestWrite).toBeGreaterThan(stemWrite);
  });

  it('reports progress per file as it unpacks', async () => {
    putStem('song', 'bass.wav', 10, 1);
    putStem('song', 'keys.wav', 10, 2);
    const bundle = await writeBundle(
      { projects: [project('song', ['bass.wav', 'keys.wav'])], folders: [] },
      new File(Paths.cache, 'out.vvs')
    );
    wipeLibrary();
    const updates: ProgressUpdate[] = [];

    await importBundle(bundle, (update) => updates.push(update));

    expect(updates.map((u) => u.phase)).toEqual(['importing', 'importing']);
    expect(updates.map((u) => u.name)).toEqual(['bass.wav', 'keys.wav']);
  });

  it('refuses a file that is not a bundle', async () => {
    const notABundle = new File(Paths.cache, 'song.mp3');
    disk.files.set(notABundle.uri, new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

    await expect(importBundle(notABundle)).rejects.toThrow(/Not a Virtual VS bundle/);
  });

  it('refuses a header that claims more bytes than the file holds', async () => {
    putStem('song', 'bass.wav', 50, 1);
    const bundle = await writeBundle(
      { projects: [project('song', ['bass.wav'])], folders: [] },
      new File(Paths.cache, 'out.vvs')
    );
    // Plausible on its own - well under the absolute cap - but impossible for
    // this file, which is the check that catches a truncated download.
    const bytes = disk.files.get(bundle.uri)!;
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(8, 100_000, true);
    wipeLibrary();

    await expect(importBundle(bundle)).rejects.toThrow(/damaged/);
  });

  it('refuses a bundle whose payload was truncated', async () => {
    putStem('song', 'bass.wav', 500, 1);
    const bundle = await writeBundle(
      { projects: [project('song', ['bass.wav'])], folders: [] },
      new File(Paths.cache, 'out.vvs')
    );
    const full = disk.files.get(bundle.uri)!;
    disk.files.set(bundle.uri, full.slice(0, full.length - 200));
    wipeLibrary();

    await expect(importBundle(bundle)).rejects.toThrow(/ended sooner/);
  });
});
