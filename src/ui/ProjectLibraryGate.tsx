import { useEffect, type ReactNode } from 'react';
import { getDemoLibraryEntry, loadProjectLibrary } from '@/storage';
import { useAppDispatch } from '@/store/hooks';
import { projectsHydrated } from '@/store/projectsSlice';

/**
 * Reads the project library off disk once, at app start.
 *
 * This lives at the root rather than in the Library screen because Expo
 * Router restores whatever route was last open - the project screen can be
 * the first thing mounted after a reload, and it needs its project to exist
 * in the store by then.
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
        // Still hydrate, with the bundled demo at least: without this the
        // Library would spin forever instead of showing something openable.
        if (!cancelled) dispatch(projectsHydrated([getDemoLibraryEntry()]));
      });

    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  return <>{children}</>;
}
