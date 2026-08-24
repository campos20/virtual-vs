import { useEffect, type ReactNode } from 'react';
import { listSetlists, loadProjectLibrary } from '@/storage';
import { useAppDispatch } from '@/store/hooks';
import { projectsHydrated } from '@/store/projectsSlice';
import { setlistsHydrated } from '@/store/setlistsSlice';

/**
 * Reads the project library, and the folders that organise it, off disk once
 * at app start.
 *
 * This lives at the root rather than in the Library screen because Expo
 * Router restores whatever route was last open - the project screen can be
 * the first thing mounted after a reload, and it needs its project to exist
 * in the store by then.
 *
 * The two reads are independent: folders only hold song ids, so a failure to
 * read them costs the user their grouping for this launch, never a song. The
 * Library falls back to showing everything loose rather than showing nothing.
 */
export function ProjectLibraryGate({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    let cancelled = false;

    loadProjectLibrary()
      .then((projects) => {
        if (!cancelled) dispatch(projectsHydrated(projects));
      })
      .catch((error) => {
        console.warn('Failed to read the project library', error);
        // Still hydrate, empty: the Library then shows its empty state rather
        // than spinning forever on a scan that already failed.
        if (!cancelled) dispatch(projectsHydrated([]));
      });

    listSetlists()
      .then((folders) => {
        if (!cancelled) dispatch(setlistsHydrated(folders));
      })
      .catch((error) => {
        console.warn('Failed to read the Library folders', error);
        if (!cancelled) dispatch(setlistsHydrated([]));
      });

    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  return <>{children}</>;
}
