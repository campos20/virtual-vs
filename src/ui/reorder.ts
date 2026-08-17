/** Swaps the id at `index` with its neighbor one step toward `direction`. Returns `ids` unchanged (same reference) at either end of the list. */
export function moveId(ids: string[], index: number, direction: 'up' | 'down'): string[] {
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}
