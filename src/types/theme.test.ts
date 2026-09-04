import { isThemeOverride } from './theme';

describe('isThemeOverride', () => {
  it('accepts every valid theme override', () => {
    expect(isThemeOverride('system')).toBe(true);
    expect(isThemeOverride('light')).toBe(true);
    expect(isThemeOverride('dark')).toBe(true);
  });

  it('rejects an unrelated string', () => {
    expect(isThemeOverride('neon')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isThemeOverride(undefined)).toBe(false);
    expect(isThemeOverride(null)).toBe(false);
    expect(isThemeOverride(42)).toBe(false);
    expect(isThemeOverride({})).toBe(false);
  });
});
