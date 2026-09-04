import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '@/ui/theme';

/** A small flag-on-a-pole, drawn with Views - see HamburgerIcon/Chevron for the same convention (no icon font/library). */
export function MarkerIcon() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <View style={styles.pole} />
      <View style={styles.flag} />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      width: 16,
      height: 16,
    },
    pole: {
      position: 'absolute',
      left: 1,
      top: 0,
      bottom: 0,
      width: 2,
      borderRadius: 1,
      backgroundColor: colors.textPrimary,
    },
    flag: {
      position: 'absolute',
      left: 3,
      top: 1,
      width: 0,
      height: 0,
      borderTopWidth: 5,
      borderBottomWidth: 5,
      borderLeftWidth: 8,
      borderTopColor: 'transparent',
      borderBottomColor: 'transparent',
      borderLeftColor: colors.accent,
    },
  });
}
