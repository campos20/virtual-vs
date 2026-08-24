import type { File } from 'expo-file-system';
import type { LibraryProjectEntry } from './projectsSlice';
import type { SetlistManifest } from '@/types/setlist';
import { createStore } from './index';
import { importBundleIntoLibrary } from './persistBundle';
import { projectsHydrated, projectsSelectors } from './projectsSlice';
import { setlistsHydrated, setlistsSelectors } from './setlistsSlice';

jest.mock('@/storage/bundle', () => ({ importBundle: jest.fn() }));
jest.mock('@/storage/setlistLibrary', () => ({ writeSetlist: jest.fn() }));
jest.mock('@/storage/appSettings', () => ({
  readAppSettings: jest.fn(() => ({})),
  writeAppSettings: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { importBundle } = require('@/storage/bundle');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { writeSetlist } = require('@/storage/setlistLibrary');

const bundleFile = { uri: 'file:///cache/set.vvs' } as File;

function project(id: string): LibraryProjectEntry {
  return {
    id,
    title: id,
    key: '',
    tracks: [],
    sections: [],
    origin: 'filesystem',
    sourceDir: `file:///document/projects/${id}`,
  };
}

function folder(id: string, songs: string[], name = id): SetlistManifest {
  return { id, name, songs, advance: 'manual', padBetween: false };
}

function resolvesTo(result: {
  projects?: LibraryProjectEntry[];
  folders?: SetlistManifest[];
  skippedProjectIds?: string[];
}) {
  importBundle.mockResolvedValue({
    projects: result.projects ?? [],
    folders: result.folders ?? [],
    skippedProjectIds: result.skippedProjectIds ?? [],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  writeSetlist.mockImplementation(() => {});
});

describe('importBundleIntoLibrary', () => {
  it('adds the projects the bundle brought', async () => {
    const store = createStore();
    resolvesTo({ projects: [project('a'), project('b')] });

    await store.dispatch(importBundleIntoLibrary(bundleFile));

    expect(projectsSelectors.selectIds(store.getState().projects)).toEqual(['a', 'b']);
  });

  it('creates a folder the bundle brought and puts it at the top of the library', async () => {
    const store = createStore();
    resolvesTo({ projects: [project('a')], folders: [folder('sunday', ['a'], 'Sunday Set')] });

    await store.dispatch(importBundleIntoLibrary(bundleFile));

    expect(setlistsSelectors.selectById(store.getState().setlists, 'sunday')?.name).toBe('Sunday Set');
    expect(writeSetlist).toHaveBeenCalledWith(folder('sunday', ['a'], 'Sunday Set'));
    expect(store.getState().settings.libraryOrder[0]).toBe('folder:sunday');
  });

  // Someone sends you an updated set: the songs you added to your copy have to
  // survive it, and re-importing the same file twice must change nothing.
  it('merges into a folder already here instead of replacing it', async () => {
    const store = createStore();
    store.dispatch(projectsHydrated([project('mine'), project('theirs')]));
    store.dispatch(setlistsHydrated([folder('sunday', ['mine'])]));
    resolvesTo({ folders: [folder('sunday', ['theirs'])] });

    await store.dispatch(importBundleIntoLibrary(bundleFile));

    // Existing order kept, new songs appended - a rehearsed set doesn't reshuffle.
    expect(setlistsSelectors.selectById(store.getState().setlists, 'sunday')?.songs).toEqual([
      'mine',
      'theirs',
    ]);
  });

  it('writes nothing when a merge would change nothing', async () => {
    const store = createStore();
    store.dispatch(setlistsHydrated([folder('sunday', ['a', 'b'])]));
    resolvesTo({ folders: [folder('sunday', ['b', 'a'])] });

    await store.dispatch(importBundleIntoLibrary(bundleFile));

    expect(writeSetlist).not.toHaveBeenCalled();
    expect(setlistsSelectors.selectById(store.getState().setlists, 'sunday')?.songs).toEqual(['a', 'b']);
  });

  it('does not re-add an existing folder to the library order', async () => {
    const store = createStore();
    store.dispatch(setlistsHydrated([folder('sunday', [])]));
    resolvesTo({ folders: [folder('sunday', ['new'])] });

    await store.dispatch(importBundleIntoLibrary(bundleFile));

    expect(store.getState().settings.libraryOrder).toEqual([]);
  });

  it('keeps the folder out of the store when its file cannot be written', async () => {
    const store = createStore();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    writeSetlist.mockImplementation(() => {
      throw new Error('disk full');
    });
    resolvesTo({ folders: [folder('sunday', [])] });

    await store.dispatch(importBundleIntoLibrary(bundleFile));

    expect(setlistsSelectors.selectAll(store.getState().setlists)).toEqual([]);
  });

  it('passes the skipped ids back, so the screen can say nothing changed', async () => {
    const store = createStore();
    resolvesTo({ skippedProjectIds: ['already-here'] });

    const result = await store.dispatch(importBundleIntoLibrary(bundleFile));

    expect(result.skippedProjectIds).toEqual(['already-here']);
  });

  it('forwards progress to the caller', async () => {
    const store = createStore();
    resolvesTo({});
    const onProgress = jest.fn();

    await store.dispatch(importBundleIntoLibrary(bundleFile, onProgress));

    expect(importBundle).toHaveBeenCalledWith(bundleFile, onProgress);
  });
});
