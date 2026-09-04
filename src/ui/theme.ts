import { useColorScheme } from 'react-native';
import { useAppSelector } from '@/store/hooks';
import type { ThemeOverride } from '@/types/theme';

export interface ThemeColors {
  background: string;
  panel: string;
  panelRaised: string;
  surface: string;
  border: string;
  borderLight: string;
  bevelLight: string;
  bevelDark: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  danger: string;
  warning: string;
}

/**
 * Shared visual language for the mixer/console UI - a dark, DAW-console
 * look, and its light counterpart. `bevelLight`/`bevelDark` are a fixed
 * "lit from above" skeuomorphic cue for fader/knob edges (ChannelStrip,
 * TransportBar, VerticalFader) - a physical lighting direction, not
 * something that logically inverts with the app's own light/dark theme, so
 * they stay identical in both palettes. Everything else keeps the same
 * relationships as the dark palette (surface always the most "raised" of
 * the four background tokens, text emphasis always tertiary < secondary <
 * primary) rather than being a straight inversion - `accent`/`danger`/
 * `warning` are darkened/muted for contrast on a light surface, the same
 * way a bright color on a white background needs a different value than on
 * black to read the same way.
 */
export const darkColors: ThemeColors = {
  background: '#000000',
  panel: '#111114',
  panelRaised: '#18181c',
  surface: '#1c1c1f',
  border: '#2c2c2e',
  borderLight: 'rgba(255,255,255,0.08)',
  bevelLight: 'rgba(255,255,255,0.12)',
  bevelDark: 'rgba(0,0,0,0.5)',
  textPrimary: '#ffffff',
  textSecondary: '#9b9b9d',
  textTertiary: '#5f5f63',
  accent: '#208AEF',
  danger: '#ff453a',
  warning: '#ffd60a',
};

export const lightColors: ThemeColors = {
  background: '#f2f2f5',
  panel: '#f7f7f9',
  panelRaised: '#fbfbfc',
  surface: '#ffffff',
  border: '#dcdce1',
  borderLight: 'rgba(0,0,0,0.08)',
  bevelLight: 'rgba(255,255,255,0.12)',
  bevelDark: 'rgba(0,0,0,0.5)',
  textPrimary: '#161618',
  textSecondary: '#6b6b6f',
  textTertiary: '#8e8e93',
  accent: '#0b5fa8',
  danger: '#d9362e',
  warning: '#8a5a00',
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

/** Soft elevation shadow for cards/panels floating above the console background. */
export const elevation = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.4,
  shadowRadius: 12,
  elevation: 6,
} as const;

/** Colored glow used behind an active/live control (accent by default). */
export function glow(color: string, radius = 10) {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: radius,
    elevation: 8,
  } as const;
}

/**
 * Resolves the persisted theme preference and the device's own color scheme
 * down to a single dark/light decision. A plain function (no hooks) so it's
 * unit-testable without rendering anything - `useThemeColors` below is just
 * this plus the two reactive data sources.
 */
export function resolveIsDark(
  themeOverride: ThemeOverride,
  // Android can report "unspecified" alongside RN's own null/undefined for
  // "the OS has no opinion" - all three fall back to dark, same as an
  // absent preference does, per this app's own default.
  systemScheme: string | null | undefined
): boolean {
  if (themeOverride === 'system') return systemScheme !== 'light';
  return themeOverride !== 'light';
}

function useIsDark(): boolean {
  const themeOverride = useAppSelector((state) => state.settings.themeOverride);
  const systemScheme = useColorScheme();
  return resolveIsDark(themeOverride, systemScheme);
}

/** The current theme's colors, reactive to the persisted preference and (when set to "system") the device's own light/dark setting. */
export function useThemeColors(): ThemeColors {
  return useIsDark() ? darkColors : lightColors;
}

/**
 * For anything that needs the dark/light decision itself, not the color
 * values - e.g. deciding which icon/label to show for the current mode.
 * Note this is the app's *theme* mode, not directly an
 * `expo-status-bar` `style` value: that prop names the icon color, not the
 * theme ('light' style = light icons, for a *dark* background), so a
 * consumer driving `<StatusBar>` from this must invert it - see
 * `_layout.tsx`.
 */
export function useThemeMode(): 'dark' | 'light' {
  return useIsDark() ? 'dark' : 'light';
}
