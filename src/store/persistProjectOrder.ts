import { writeAppSettings } from '@/storage/appSettings';
import type { AppDispatch } from './index';
import { projectsReordered } from './projectsSlice';

/** Commits a drag-to-reorder in the Library and persists the new order (including the bundled demo). */
export function persistProjectsReordered(orderedIds: string[]) {
  return (dispatch: AppDispatch) => {
    dispatch(projectsReordered(orderedIds));
    writeAppSettings({ projectOrder: orderedIds });
  };
}
