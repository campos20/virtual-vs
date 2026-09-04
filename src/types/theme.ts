export const THEME_OVERRIDES = ['system', 'light', 'dark'] as const;
export type ThemeOverride = (typeof THEME_OVERRIDES)[number];

/** Guards a JSON.parse'd disk value before trusting it as state - see storage/appSettings.ts. */
export function isThemeOverride(value: unknown): value is ThemeOverride {
  return typeof value === 'string' && (THEME_OVERRIDES as readonly string[]).includes(value);
}
