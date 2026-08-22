import type { ProjectManifest } from '@/types/project';
import type { SetlistManifest } from '@/types/setlist';
import {
  BUNDLE_MAGIC,
  BUNDLE_PREAMBLE_BYTES,
  BUNDLE_VERSION,
  BundleFormatError,
  bundleEntries,
  bundleSize,
  decodeBundleHeader,
  decodeBundlePreamble,
  encodeBundleHeader,
  type BundleHeader,
} from './bundleFormat';

function manifest(id: string, title = id): ProjectManifest {
  return {
    id,
    title,
    key: '',
    tracks: [{ id: 'bass', name: 'Bass', file: 'bass.wav', gain: 1, bus: 'main' }],
    sections: [],
  };
}

function folder(id: string, songs: string[]): SetlistManifest {
  return { id, name: id, songs, advance: 'manual', padBetween: false };
}

function header(overrides: Partial<BundleHeader> = {}): BundleHeader {
  return {
    format: 'virtual-vs-bundle',
    version: BUNDLE_VERSION,
    folders: [],
    projects: [{ manifest: manifest('song'), files: [{ name: 'bass.wav', size: 100 }] }],
    ...overrides,
  };
}

/** Reads a bundle's header back out of its own bytes, the way the importer does. */
function roundTrip(source: BundleHeader): BundleHeader {
  const bytes = encodeBundleHeader(source);
  const { headerLength } = decodeBundlePreamble(bytes);
  return decodeBundleHeader(bytes.subarray(BUNDLE_PREAMBLE_BYTES, BUNDLE_PREAMBLE_BYTES + headerLength));
}

describe('bundle preamble', () => {
  it('starts with the magic and the format version', () => {
    const bytes = encodeBundleHeader(header());

    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe(BUNDLE_MAGIC);
    expect(decodeBundlePreamble(bytes)).toMatchObject({ version: BUNDLE_VERSION });
  });

  it('reports the header length, so a reader never has to load the whole file', () => {
    const bytes = encodeBundleHeader(header());
    const { headerLength } = decodeBundlePreamble(bytes);

    expect(headerLength).toBe(bytes.length - BUNDLE_PREAMBLE_BYTES);
  });

  it('rejects a file that is not a bundle', () => {
    const notABundle = new Uint8Array(64);
    notABundle.set([0x49, 0x44, 0x33], 0); // "ID3" - an mp3

    expect(() => decodeBundlePreamble(notABundle)).toThrow(BundleFormatError);
  });

  it('rejects a file too short to even have a preamble', () => {
    expect(() => decodeBundlePreamble(new Uint8Array(4))).toThrow(/too short/);
  });

  // Better than failing halfway through an import with a confusing error.
  it('refuses a bundle from a newer app rather than guessing at its layout', () => {
    const bytes = encodeBundleHeader(header({ version: BUNDLE_VERSION + 1 }));

    expect(() => decodeBundlePreamble(bytes)).toThrow(/newer version/);
  });
});

describe('bundle header', () => {
  it('round-trips projects and the folders that group them', () => {
    const source = header({
      folders: [folder('sunday', ['song', 'other'])],
      projects: [
        { manifest: manifest('song'), files: [{ name: 'bass.wav', size: 100 }] },
        { manifest: manifest('other'), files: [{ name: 'keys.wav', size: 200 }] },
      ],
    });

    const decoded = roundTrip(source);

    expect(decoded.folders[0].songs).toEqual(['song', 'other']);
    expect(decoded.projects.map((p) => p.manifest.id)).toEqual(['song', 'other']);
  });

  // The whole reason the header is ASCII-escaped rather than raw UTF-8: this
  // app ships in pt-BR, and a title losing its accents on a round trip through
  // someone else's phone would be a quiet, permanent corruption.
  it('preserves accented and non-Latin titles exactly', () => {
    const titles = ['Coração Valente', 'Não Vou Voltar', 'ハレルヤ', 'Σήμερα'];
    const source = header({
      projects: titles.map((title, index) => ({
        manifest: manifest(`song-${index}`, title),
        files: [],
      })),
    });

    expect(roundTrip(source).projects.map((p) => p.manifest.title)).toEqual(titles);
  });

  it('preserves characters outside the BMP, which travel as surrogate pairs', () => {
    const source = header({ projects: [{ manifest: manifest('song', 'Set 🎸'), files: [] }] });

    expect(roundTrip(source).projects[0].manifest.title).toBe('Set 🎸');
  });

  it('writes the header JSON as pure ASCII, so no byte can be mis-decoded', () => {
    const bytes = encodeBundleHeader(header({ projects: [{ manifest: manifest('s', 'Coração'), files: [] }] }));

    // Only the JSON: the preamble ahead of it is binary, and a header longer
    // than 127 bytes puts a byte above 0x7f in its length field by design.
    const json = bytes.subarray(BUNDLE_PREAMBLE_BYTES);
    expect(json.every((byte) => byte <= 0x7f)).toBe(true);
  });

  it('rejects JSON that parses but is not a bundle index', () => {
    const json = JSON.stringify({ format: 'something-else', projects: [] });
    const bytes = new Uint8Array(json.length);
    for (let i = 0; i < json.length; i++) bytes[i] = json.charCodeAt(i);

    expect(() => decodeBundleHeader(bytes)).toThrow(/Not a Virtual VS bundle/);
  });

  it('reports a damaged index as damaged rather than crashing', () => {
    const bytes = new Uint8Array([0x7b, 0x7b, 0x7b]); // "{{{"

    expect(() => decodeBundleHeader(bytes)).toThrow(/damaged/);
  });

  // A truncated or hand-edited bundle can lose it, and the import walks it.
  it('tolerates a missing folders list', () => {
    const json = JSON.stringify({ format: 'virtual-vs-bundle', version: 1, projects: [] });
    const bytes = new Uint8Array(json.length);
    for (let i = 0; i < json.length; i++) bytes[i] = json.charCodeAt(i);

    expect(decodeBundleHeader(bytes).folders).toEqual([]);
  });
});

describe('bundleEntries', () => {
  it('lays every file out back to back, after the header', () => {
    const source = header({
      projects: [
        {
          manifest: manifest('a'),
          files: [
            { name: 'bass.wav', size: 100 },
            { name: 'keys.wav', size: 50 },
          ],
        },
        { manifest: manifest('b'), files: [{ name: 'vox.wav', size: 25 }] },
      ],
    });

    expect(bundleEntries(source, 1000)).toEqual([
      { projectId: 'a', name: 'bass.wav', offset: 1000, size: 100 },
      { projectId: 'a', name: 'keys.wav', offset: 1100, size: 50 },
      { projectId: 'b', name: 'vox.wav', offset: 1150, size: 25 },
    ]);
  });

  it('handles a project with no stems without disturbing the ones after it', () => {
    const source = header({
      projects: [
        { manifest: manifest('empty'), files: [] },
        { manifest: manifest('b'), files: [{ name: 'vox.wav', size: 25 }] },
      ],
    });

    expect(bundleEntries(source, 12)).toEqual([
      { projectId: 'b', name: 'vox.wav', offset: 12, size: 25 },
    ]);
  });
});

describe('bundleSize', () => {
  it('counts the header and every file, so a size can be shown before writing', () => {
    const source = header({
      projects: [
        { manifest: manifest('a'), files: [{ name: 'bass.wav', size: 100 }] },
        { manifest: manifest('b'), files: [{ name: 'vox.wav', size: 25 }] },
      ],
    });

    expect(bundleSize(source)).toBe(encodeBundleHeader(source).length + 125);
  });
});
