import { StyleSheet, View } from 'react-native';
import { colors } from '@/ui/theme';

/** Three stacked bars, drawn with Views - see Chevron.tsx for the same convention (no icon font/library). */
export function HamburgerIcon() {
  return (
    <View style={styles.container}>
      <View style={styles.bar} />
      <View style={styles.bar} />
      <View style={styles.bar} />
    </View>
  );
}

const styles = StyleSheet.create({
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
