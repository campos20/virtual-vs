import { File } from 'expo-file-system';
import { createSetlist, deleteSetlist, listSetlists, writeSetlist } from './setlistLibrary';

jest.mock('./paths', () => ({
  ensureSetlistsDirectoryExists: jest.fn(),
  setlistsDirectory: { list: jest.fn() },
  setlistFile: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setlistsDirectory, setlistFile } = require('./paths');
const listMock = setlistsDirectory.list as jest.Mock;
const setlistFileMock = setlistFile as jest.Mock;

/**
 * A File-shaped stub whose `json()` resolves (or rejects) however the test
 * needs. `name` is defined as an own property because File declares it as a
 * prototype getter, which a plain assignment can't shadow - and listSetlists
 * filters on the extension, so the name has to be readable.
 */
function fileAt(name: string, json: () => Promise<unknown>): File {
  const file = Object.create(File.prototype);
  Object.defineProperty(file, 'name', { value: name });
  return Object.assign(file, { json }) as File;
}

function folder(id: string) {
  return { id, name: id, songs: [], advance: 'manual' as const, padBetween: false };
}

beforeEach(() => jest.clearAllMocks());

describe('listSetlists', () => {
  it('reads one folder per json file', async () => {
    listMock.mockReturnValue([
      fileAt('a.json', async () => folder('a')),
      fileAt('b.json', async () => folder('b')),
    ]);

    expect((await listSetlists()).map((f) => f.id)).toEqual(['a', 'b']);
  });

  // The stated guarantee: losing the whole Library right before a set is far
  // worse than losing one folder, so a bad file is skipped, not fatal.
  it('skips a folder whose file cannot be read, keeping the rest', async () => {
    listMock.mockReturnValue([
      fileAt('broken.json', async () => {
        throw new Error('unreadable');
      }),
      fileAt('good.json', async () => folder('good')),
    ]);

    expect((await listSetlists()).map((f) => f.id)).toEqual(['good']);
  });

  it('skips a file that parses but is not a folder', async () => {
    listMock.mockReturnValue([
      fileAt('no-id.json', async () => ({ name: 'x', songs: [] })),
      fileAt('no-songs.json', async () => ({ id: 'y', name: 'y' })),
      fileAt('good.json', async () => folder('good')),
    ]);

    expect((await listSetlists()).map((f) => f.id)).toEqual(['good']);
  });

  it('ignores anything that is not a json file', async () => {
    listMock.mockReturnValue([
      { name: 'notes.txt' },
      fileAt('good.json', async () => folder('good')),
    ]);

    expect((await listSetlists()).map((f) => f.id)).toEqual(['good']);
  });
});

describe('createSetlist', () => {
  it('writes a slugged, timestamped id and controller defaults', () => {
    const write = jest.fn();
    setlistFileMock.mockReturnValue({ write });

    const created = createSetlist('Sunday Set');

    expect(created.id).toMatch(/^sunday-set-[a-z0-9]+$/);
    expect(created).toMatchObject({ name: 'Sunday Set', songs: [] });
    // Written now so the file is already the shape setlist mode will expect.
    expect(created).toMatchObject({ advance: 'manual', padBetween: false });
    expect(JSON.parse(write.mock.calls[0][0])).toEqual(created);
  });

  it('falls back to a usable id when the name has nothing sluggable in it', () => {
    setlistFileMock.mockReturnValue({ write: jest.fn() });

    expect(createSetlist('...').id).toMatch(/^folder-[a-z0-9]+$/);
  });
});

describe('writeSetlist', () => {
  it('writes the whole manifest', () => {
    const write = jest.fn();
    setlistFileMock.mockReturnValue({ write });

    writeSetlist({ ...folder('set'), songs: ['a', 'b'] });

    expect(JSON.parse(write.mock.calls[0][0]).songs).toEqual(['a', 'b']);
  });
});

describe('deleteSetlist', () => {
  it('deletes the file', () => {
    const remove = jest.fn();
    setlistFileMock.mockReturnValue({ exists: true, delete: remove });

    deleteSetlist('set');

    expect(remove).toHaveBeenCalled();
  });

  it('is a no-op when the file is already gone', () => {
    const remove = jest.fn();
    setlistFileMock.mockReturnValue({ exists: false, delete: remove });

    deleteSetlist('set');

    expect(remove).not.toHaveBeenCalled();
  });
});
