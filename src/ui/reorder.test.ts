import { moveId } from './reorder';

describe('moveId', () => {
  it('swaps with the previous id when moving up', () => {
    expect(moveId(['a', 'b', 'c'], 1, 'up')).toEqual(['b', 'a', 'c']);
  });

  it('swaps with the next id when moving down', () => {
    expect(moveId(['a', 'b', 'c'], 1, 'down')).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op moving the first id up', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveId(ids, 0, 'up')).toBe(ids);
  });

  it('is a no-op moving the last id down', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveId(ids, 2, 'down')).toBe(ids);
  });

  it('is a no-op on a single-item list either direction', () => {
    const ids = ['a'];
    expect(moveId(ids, 0, 'up')).toBe(ids);
    expect(moveId(ids, 0, 'down')).toBe(ids);
  });
});
