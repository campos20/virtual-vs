import { Directory } from 'expo-file-system';
import type { LibraryProjectEntry } from '@/store/projectsSlice';
import { applyPersistedOrder, listFilesystemProjects, loadProjectLibrary } from './projectLibrary';
import { readAppSettings } from './appSettings';
import { readProjectManifest } from './projectLoader';

jest.mock('./paths', () => ({
  ensureProjectsDirectoryExists: jest.fn(),
  projectsDirectory: { list: jest.fn() },
}));

jest.mock('./projectLoader', () => ({ readProjectManifest: jest.fn() }));

jest.mock('./appSettings', () => ({ readAppSettings: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { projectsDirectory } = require('./paths');
const listMock = projectsDirectory.list as jest.Mock;
const readManifestMock = readProjectManifest as jest.Mock;
const readSettingsMock = readAppSettings as jest.Mock;

function directoryAt(uri: string): Directory {
  return Object.assign(Object.create(Directory.prototype), { uri }) as Directory;
}

function manifestFor(id: string) {
  return { id, title: id, key: '', tracks: [], sections: [] };
}

beforeEach(() => {
  jest.clearAllMocks();
  readSettingsMock.mockReturnValue({});
});

describe('listFilesystemProjects', () => {
  it('reads a manifest per project folder', async () => {
    listMock.mockReturnValue([directoryAt('file:///projects/a'), directoryAt('file:///projects/b')]);
    readManifestMock.mockImplementation(async (dir: Directory) =>
      manifestFor(dir.uri.endsWith('/a') ? 'a' : 'b')
    );

    const projects = await listFilesystemProjects();

    expect(projects.map((p) => p.id)).toEqual(['a', 'b']);
    expect(projects[0]).toMatchObject({
      origin: 'filesystem',
      sourceDir: 'file:///projects/a',
    });
  });

  // One unreadable folder must not cost the user the rest of their library.
  it('skips folders whose manifest cannot be read', async () => {
    listMock.mockReturnValue([directoryAt('file:///projects/ok'), directoryAt('file:///projects/bad')]);
    readManifestMock.mockImplementation(async (dir: Directory) => {
      if (dir.uri.endsWith('/bad')) throw new Error('corrupt');
      return manifestFor('ok');
    });

    const projects = await listFilesystemProjects();

    expect(projects.map((p) => p.id)).toEqual(['ok']);
  });

  it('skips manifests missing the fields the app depends on', async () => {
    listMock.mockReturnValue([directoryAt('file:///projects/x'), directoryAt('file:///projects/y')]);
    readManifestMock
      .mockResolvedValueOnce({ title: 'no id', tracks: [] })
      .mockResolvedValueOnce({ id: 'y', title: 'no tracks array' });

    expect(await listFilesystemProjects()).toEqual([]);
  });

  it('ignores loose files sitting next to the project folders', async () => {
    listMock.mockReturnValue([{ uri: 'file:///projects/stray.txt' }, directoryAt('file:///projects/a')]);
    readManifestMock.mockResolvedValue(manifestFor('a'));

    const projects = await listFilesystemProjects();

    expect(projects.map((p) => p.id)).toEqual(['a']);
    expect(readManifestMock).toHaveBeenCalledTimes(1);
  });
});

describe('loadProjectLibrary', () => {
  it('always includes the bundled demo alongside disk projects', async () => {
    listMock.mockReturnValue([directoryAt('file:///projects/a')]);
    readManifestMock.mockResolvedValue(manifestFor('a'));

    const projects = await loadProjectLibrary();

    expect(projects[0].origin).toBe('bundled');
    expect(projects.map((p) => p.id)).toContain('a');
  });

  it('applies a saved drag order, including reordering the bundled demo', async () => {
    listMock.mockReturnValue([directoryAt('file:///projects/a'), directoryAt('file:///projects/b')]);
    readManifestMock.mockImplementation(async (dir: Directory) =>
      manifestFor(dir.uri.endsWith('/a') ? 'a' : 'b')
    );
    readSettingsMock.mockReturnValue({ projectOrder: ['b', 'demo-sync-test', 'a'] });

    const projects = await loadProjectLibrary();

    expect(projects.map((p) => p.id)).toEqual(['b', 'demo-sync-test', 'a']);
  });
});

describe('applyPersistedOrder', () => {
  function entry(id: string): LibraryProjectEntry {
    return { id, title: id, key: '', tracks: [], sections: [], origin: 'filesystem' };
  }
  const a = entry('a');
  const b = entry('b');
  const c = entry('c');

  it('returns the scan order untouched when there is no saved order yet', () => {
    expect(applyPersistedOrder([a, b, c], undefined)).toEqual([a, b, c]);
    expect(applyPersistedOrder([a, b, c], [])).toEqual([a, b, c]);
  });

  it('reorders entries to match the saved order', () => {
    expect(applyPersistedOrder([a, b, c], ['c', 'a', 'b'])).toEqual([c, a, b]);
  });

  it('appends a project the user never ordered (newly created) after the ordered ones', () => {
    expect(applyPersistedOrder([a, b, c], ['b'])).toEqual([b, a, c]);
  });

  it('drops ids from the saved order that no longer exist (a deleted project)', () => {
    expect(applyPersistedOrder([a, b], ['x', 'b', 'a'])).toEqual([b, a]);
  });
});
