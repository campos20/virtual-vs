import { Directory } from 'expo-file-system';
import type { ProjectManifest } from '@/types/project';
import { readProjectManifest } from './projectLoader';

/**
 * A minimal stand-in for the one `File` call `readProjectManifest`/
 * `normalizeSections` actually make: read `manifest.json`, and (only when
 * backfilling a legacy section) write it back. `mockManifest`/`mockWrites`
 * are prefixed with "mock" so babel-plugin-jest-hoist allows the factory to
 * close over them.
 */
let mockManifest: unknown;
const mockWrites: string[] = [];

jest.mock('expo-file-system', () => ({
  Directory: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
  },
  File: class {
    async json() {
      return mockManifest;
    }
    write(content: string) {
      mockWrites.push(content);
    }
  },
}));

const directory = new Directory('file:///mock/project');

function manifestWithSections(sections: unknown): ProjectManifest {
  return {
    id: 'song',
    title: 'Song',
    key: '',
    tracks: [],
    sections,
  } as ProjectManifest;
}

beforeEach(() => {
  mockWrites.length = 0;
});

describe('readProjectManifest', () => {
  // SectionManifest.id was added after `sections` itself - the README's
  // documented manifest.json schema (and every manifest written before this
  // field existed) only guarantees `{ name, startSec }`.
  it('backfills a stable id onto a legacy section and persists the fix', async () => {
    mockManifest = manifestWithSections([{ name: 'Chorus', startSec: 30 }]);

    const result = await readProjectManifest(directory);

    expect(result.sections[0].id).toEqual(expect.any(String));
    expect(mockWrites).toHaveLength(1);
    expect(JSON.parse(mockWrites[0]).sections[0].id).toBe(result.sections[0].id);
  });

  it('backfills a distinct id for each of several legacy sections', async () => {
    mockManifest = manifestWithSections([
      { name: 'Intro', startSec: 0 },
      { name: 'Chorus', startSec: 30 },
    ]);

    const result = await readProjectManifest(directory);

    const ids = result.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('does not rewrite the manifest when every section already has an id', async () => {
    mockManifest = manifestWithSections([{ id: 'chorus', name: 'Chorus', startSec: 30 }]);

    const result = await readProjectManifest(directory);

    expect(result.sections).toEqual([{ id: 'chorus', name: 'Chorus', startSec: 30 }]);
    expect(mockWrites).toHaveLength(0);
  });

  it('does not rewrite an empty sections list', async () => {
    mockManifest = manifestWithSections([]);

    await readProjectManifest(directory);

    expect(mockWrites).toHaveLength(0);
  });

  it('defaults a missing sections field to an empty array without writing', async () => {
    const { sections: _omit, ...withoutSections } = manifestWithSections([]);
    mockManifest = withoutSections;

    const result = await readProjectManifest(directory);

    expect(result.sections).toEqual([]);
    expect(mockWrites).toHaveLength(0);
  });
});
