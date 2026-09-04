import { resolveIsDark } from './theme';

describe('resolveIsDark', () => {
  it('follows the system scheme when set to "system"', () => {
    expect(resolveIsDark('system', 'light')).toBe(false);
    expect(resolveIsDark('system', 'dark')).toBe(true);
  });

  it('treats an unknown/null system scheme as dark under "system"', () => {
    expect(resolveIsDark('system', null)).toBe(true);
    expect(resolveIsDark('system', undefined)).toBe(true);
    expect(resolveIsDark('system', 'unspecified')).toBe(true);
  });

  it('ignores the system scheme when explicitly overridden', () => {
    expect(resolveIsDark('light', 'dark')).toBe(false);
    expect(resolveIsDark('dark', 'light')).toBe(true);
    expect(resolveIsDark('dark', null)).toBe(true);
  });
});
