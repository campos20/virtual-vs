import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '@/ui/theme';

/** Three stacked bars, drawn with Views - see Chevron.tsx for the same convention (no icon font/library). */
export function HamburgerIcon() {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <View style={styles.bar} />
      <View style={styles.bar} />
      <View style={styles.bar} />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      width: 18,
      height: 13,
      justifyContent: 'space-between',
    },
    bar: {
      height: 2,
      borderRadius: 1,
      backgroundColor: colors.textPrimary,
    },
  });
}
