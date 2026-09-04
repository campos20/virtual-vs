import { StyleSheet, View } from 'react-native';
import { colors } from '@/ui/theme';

/**
 * A few varied-width lines suggesting text, drawn with Views - see
 * HamburgerIcon/MarkerIcon for the same convention (no icon font/library).
 * Widths vary (unlike HamburgerIcon's equal bars) so it reads as "text"
 * rather than a generic menu glyph.
 */
export function LyricsIcon() {
  return (
    <View style={styles.container}>
      <View style={[styles.bar, { width: '100%' }]} />
      <View style={[styles.bar, { width: '70%' }]} />
      <View style={[styles.bar, { width: '85%' }]} />
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
