import { Directory } from 'expo-file-system';
import { listFilesystemProjects, loadProjectLibrary } from './projectLibrary';
import { readProjectManifest } from './projectLoader';

jest.mock('./paths', () => ({
  ensureProjectsDirectoryExists: jest.fn(),
  projectsDirectory: { list: jest.fn() },
}));

jest.mock('./projectLoader', () => ({ readProjectManifest: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { projectsDirectory } = require('./paths');
const listMock = projectsDirectory.list as jest.Mock;
const readManifestMock = readProjectManifest as jest.Mock;

function directoryAt(uri: string): Directory {
  return Object.assign(Object.create(Directory.prototype), { uri }) as Directory;
}

function manifestFor(id: string) {
  return { id, title: id, key: '', tracks: [], sections: [] };
}

beforeEach(() => {
  jest.clearAllMocks();
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
});
