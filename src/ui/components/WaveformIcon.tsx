import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '@/ui/theme';

interface WaveformIconProps {
  /** Overrides the default `colors.textPrimary` fill - needed when this icon sits on an active/accent-colored segment (see ProjectScreen's view switcher) and would otherwise lose contrast. */
  color?: string;
}

/** A row of bars at varying heights, like an audio waveform - see HamburgerIcon/MarkerIcon for the same convention (no icon font/library). */
export function WaveformIcon({ color }: WaveformIconProps = {}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors, color), [colors, color]);

  return (
    <View style={styles.container}>
      <View style={[styles.bar, styles.barShort]} />
      <View style={[styles.bar, styles.barTall]} />
      <View style={[styles.bar, styles.barMedium]} />
      <View style={[styles.bar, styles.barTall]} />
      <View style={[styles.bar, styles.barShort]} />
    </View>
  );
}

function createStyles(colors: ThemeColors, color?: string) {
  const fill = color ?? colors.textPrimary;
  return StyleSheet.create({
    container: {
      width: 18,
      height: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    bar: {
      width: 2,
      borderRadius: 1,
      backgroundColor: fill,
    },
    barShort: {
      height: 6,
    },
    barMedium: {
      height: 11,
    },
    barTall: {
      height: 16,
    },
  });
}
