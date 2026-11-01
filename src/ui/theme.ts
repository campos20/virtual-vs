import { Platform, useColorScheme } from "react-native";
import { useAppSelector } from "@/store/hooks";
import type { ThemeOverride } from "@/types/theme";

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
  /** Lit transport "play" button - green, the way DAW transports show it. */
  play: string;
  danger: string;
  warning: string;
}

/**
 * Shared visual language for the mixer/console UI - a flat, charcoal
 * DAW-console look, and its light counterpart. `bevelLight`/`bevelDark` are
 * a fixed "lit from above" cue for fader/button edges (ChannelStrip,
 * TransportBar, VerticalFader) - a physical lighting direction, not
 * something that logically inverts with the app's own light/dark theme, so
 * they stay identical in both palettes. Everything else keeps the same
 * relationships as the dark palette (surface always the most "raised" of
 * the four background tokens, text emphasis always tertiary < secondary <
 * primary) rather than being a straight inversion - `accent`/`play`/
 * `danger`/`warning` are darkened/muted for contrast on a light surface,
 * the same way a bright color on a white background needs a different
 * value than on black to read the same way.
 */
export const darkColors: ThemeColors = {
  background: "#141416",
  panel: "#1c1c1f",
  panelRaised: "#242428",
  surface: "#2e2e33",
  border: "#38383e",
  borderLight: "rgba(255,255,255,0.07)",
  bevelLight: "rgba(255,255,255,0.12)",
  bevelDark: "rgba(0,0,0,0.5)",
  textPrimary: "#f2f2f4",
  textSecondary: "#a0a0a6",
  textTertiary: "#66666c",
  accent: "#208AEF",
  play: "#30d158",
  danger: "#ff453a",
  warning: "#ffd60a",
};

export const lightColors: ThemeColors = {
  background: "#e9e9ed",
  panel: "#f2f2f5",
  panelRaised: "#f8f8fa",
  surface: "#ffffff",
  border: "#d2d2d8",
  borderLight: "rgba(0,0,0,0.08)",
  bevelLight: "rgba(255,255,255,0.12)",
  bevelDark: "rgba(0,0,0,0.5)",
  textPrimary: "#161618",
  textSecondary: "#5f5f64",
  textTertiary: "#8e8e93",
  accent: "#0b5fa8",
  play: "#1f8a3a",
  danger: "#d9362e",
  warning: "#8a5a00",
};

/**
 * The always-dark "LCD" surfaces - the transport's time display, fader
 * readouts, the bus selector - stay dark in both themes, like the display
 * on a hardware unit. Their text therefore can't use the theme's text
 * tokens (recalibrated for a *light* surface in light mode, where they'd
 * lose contrast here), so it has its own fixed set.
 */
export const lcd = {
  background: "#0b0c0e",
  border: "rgba(0,0,0,0.6)",
  text: "#e8eef2",
  textDim: "#8f9aa3",
  textFaint: "#4a5259",
  accent: "#208AEF",
} as const;

/**
 * Monospaced system font for time and level readouts, so digits don't jitter
 * as they change. A system font on each platform - nothing bundled.
 */
export const monoFont = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, Menlo, Consolas, monospace",
});

/** Small, square-ish corners - a console, not a card stack. */
export const radii = {
  sm: 3,
  md: 4,
  lg: 6,
  xl: 8,
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
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.4,
  shadowRadius: 12,
  elevation: 6,
} as const;

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
  systemScheme: string | null | undefined,
): boolean {
  if (themeOverride === "system") return systemScheme !== "light";
  return themeOverride !== "light";
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
export function useThemeMode(): "dark" | "light" {
  return useIsDark() ? "dark" : "light";
}
