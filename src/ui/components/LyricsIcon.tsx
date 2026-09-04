import { StyleSheet, View } from 'react-native';
import { colors } from '@/ui/theme';

/**
 * A single eighth note (head + stem + flag), drawn with Views - see
 * HamburgerIcon/MarkerIcon for the same convention (no icon font/library).
 * Previously three horizontal bars, which read as a near-duplicate of
 * HamburgerIcon's three equal bars (the Mixer button right next to it in
 * the header) at toolbar size - a musical note is a categorically different
 * silhouette, not just a width tweak, and reads unambiguously as "song
 * content" rather than another menu/list glyph.
 */
export function LyricsIcon() {
  return (
    <View style={styles.container}>
      <View style={styles.stem} />
      <View style={styles.flag} />
      <View style={styles.head} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 16,
    height: 18,
  },
  head: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: 9,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.textPrimary,
  },
  stem: {
    position: 'absolute',
    left: 7,
    top: 0,
    width: 2,
    height: 11,
    borderRadius: 1,
    backgroundColor: colors.textPrimary,
  },
  flag: {
    position: 'absolute',
    left: 9,
    top: 0,
    width: 0,
    height: 0,
    borderTopWidth: 6,
    borderRightWidth: 6,
    borderTopColor: colors.textPrimary,
    borderRightColor: 'transparent',
  },
});
