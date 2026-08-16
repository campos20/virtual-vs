import { File, Paths } from 'expo-file-system';
import { createStore } from './index';
import { persistProjectsReordered } from './persistProjectOrder';
import { projectsHydrated, projectsSelectors, type LibraryProjectEntry } from './projectsSlice';

const settingsFile = new File(Paths.document, 'settings.json');

beforeEach(() => {
  if (settingsFile.exists) settingsFile.delete();
});

function buildEntry(id: string): LibraryProjectEntry {
  return { id, title: id, key: '', tracks: [], sections: [], origin: 'filesystem' };
}

describe('persistProjectsReordered', () => {
  it('updates the store and persists the new order to disk', () => {
    const store = createStore();
    store.dispatch(projectsHydrated([buildEntry('a'), buildEntry('b'), buildEntry('c')]));

    store.dispatch(persistProjectsReordered(['c', 'a', 'b']));

    expect(projectsSelectors.selectIds(store.getState().projects)).toEqual(['c', 'a', 'b']);
    expect(JSON.parse(settingsFile.textSync())).toEqual({ projectOrder: ['c', 'a', 'b'] });
  });
});
