import { createStore } from './index';
import {
  addSongToFolder,
  createFolder,
  deleteFolder,
  persistLibraryOrder,
  removeSongFromAllFolders,
  renameFolder,
} from './persistFolders';
import { setlistsHydrated, setlistsSelectors } from './setlistsSlice';

jest.mock('@/storage/setlistLibrary', () => ({
  createSetlist: jest.fn(),
  deleteSetlist: jest.fn(),
  writeSetlist: jest.fn(),
}));
jest.mock('@/storage/appSettings', () => ({
  readAppSettings: jest.fn(() => ({})),
  writeAppSettings: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const storage = require('@/storage/setlistLibrary');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readAppSettings, writeAppSettings } = require('@/storage/appSettings');

function folder(id: string, songs: string[] = []) {
  return { id, name: id, songs, advance: 'manual' as const, padBetween: false };
}

function storeWith(...folders: ReturnType<typeof folder>[]) {
  const store = createStore();
  store.dispatch(setlistsHydrated(folders));
  return store;
}

// clearAllMocks resets calls but NOT implementations, so a test that makes a
// write throw would otherwise leave it throwing for every test after it.
beforeEach(() => {
  jest.clearAllMocks();
  storage.writeSetlist.mockImplementation(() => {});
  storage.deleteSetlist.mockImplementation(() => {});
  readAppSettings.mockReturnValue({});
});

// Restores the console.warn spies the failure paths install.
afterEach(() => jest.restoreAllMocks());

describe('folder writes', () => {
  it('writes the file before updating the store', () => {
    const store = storeWith(folder('set'));
    const order: string[] = [];
    storage.writeSetlist.mockImplementation(() => order.push('disk'));

    store.dispatch(addSongToFolder('set', 'song'));

    order.push('store');
    expect(order).toEqual(['disk', 'store']);
    expect(setlistsSelectors.selectById(store.getState().setlists, 'set')?.songs).toEqual(['song']);
  });

  // The manifest is the record: a store that claims a change the disk didn't
  // take would survive until the next launch and then silently revert.
  it('leaves the store alone when the write fails', () => {
    const store = storeWith(folder('set'));
    storage.writeSetlist.mockImplementation(() => {
      throw new Error('disk full');
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    store.dispatch(addSongToFolder('set', 'song'));

    expect(setlistsSelectors.selectById(store.getState().setlists, 'set')?.songs).toEqual([]);
  });

  it('ignores a song already in the folder, so a double tap cannot duplicate it', () => {
    const store = storeWith(folder('set', ['song']));

    store.dispatch(addSongToFolder('set', 'song'));

    expect(storage.writeSetlist).not.toHaveBeenCalled();
  });

  it('ignores a write to a folder that is not in the store', () => {
    const store = storeWith();

    store.dispatch(renameFolder('gone', 'New name'));

    expect(storage.writeSetlist).not.toHaveBeenCalled();
  });
});

describe('createFolder', () => {
  // Every other write here logs and leaves state untouched on failure; this
  // one used to be the exception, and would have thrown into the UI instead.
  it('keeps the folder out of the library when the file cannot be written', () => {
    const store = createStore();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    storage.createSetlist.mockImplementation(() => {
      throw new Error('disk full');
    });

    const created = store.dispatch(createFolder('Fresh'));

    expect(created).toBeNull();
    expect(setlistsSelectors.selectAll(store.getState().setlists)).toEqual([]);
    expect(store.getState().settings.libraryOrder).toEqual([]);
  });

  it('puts the new folder first in the library order and persists it', () => {
    const store = createStore();
    store.dispatch(persistLibraryOrder(['project:existing']));
    storage.createSetlist.mockReturnValue(folder('fresh'));

    store.dispatch(createFolder('Fresh'));

    expect(store.getState().settings.libraryOrder).toEqual(['folder:fresh', 'project:existing']);
    expect(writeAppSettings).toHaveBeenLastCalledWith({
      libraryOrder: ['folder:fresh', 'project:existing'],
    });
  });
});

describe('deleteFolder', () => {
  it('removes the folder and drops it from the library order', () => {
    const store = storeWith(folder('set', ['song']));
    store.dispatch(persistLibraryOrder(['folder:set', 'project:other']));

    store.dispatch(deleteFolder('set'));

    expect(storage.deleteSetlist).toHaveBeenCalledWith('set');
    expect(setlistsSelectors.selectAll(store.getState().setlists)).toEqual([]);
    expect(store.getState().settings.libraryOrder).toEqual(['project:other']);
  });

  it('keeps the folder when the delete fails', () => {
    const store = storeWith(folder('set'));
    storage.deleteSetlist.mockImplementation(() => {
      throw new Error('read-only');
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    store.dispatch(deleteFolder('set'));

    expect(setlistsSelectors.selectIds(store.getState().setlists)).toEqual(['set']);
  });
});

describe('removeSongFromAllFolders', () => {
  it('drops a deleted project from every folder that listed it, and only those', () => {
    const store = storeWith(
      folder('sunday', ['gone', 'kept']),
      folder('wedding', ['gone']),
      folder('rehearsal', ['kept'])
    );

    store.dispatch(removeSongFromAllFolders('gone'));

    const state = store.getState().setlists;
    expect(setlistsSelectors.selectById(state, 'sunday')?.songs).toEqual(['kept']);
    expect(setlistsSelectors.selectById(state, 'wedding')?.songs).toEqual([]);
    expect(setlistsSelectors.selectById(state, 'rehearsal')?.songs).toEqual(['kept']);
    expect(storage.writeSetlist).toHaveBeenCalledTimes(2);
  });
});
