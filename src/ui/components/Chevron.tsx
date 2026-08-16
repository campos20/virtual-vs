import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/ui/theme';

interface ChevronProps {
  direction?: 'left' | 'right';
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A "‹"/"›" arrow drawn from a rotated bordered corner, not a glyph/icon
 * font - see TransportBar's play triangle/pause bars for the same
 * convention (plain Views, not text glyphs or an icon library).
 */
export function Chevron({ direction = 'right', color = colors.accent, size = 9, style }: ChevronProps) {
  const corner =
    direction === 'left'
      ? { borderLeftWidth: 2.5, borderBottomWidth: 2.5 }
      : { borderTopWidth: 2.5, borderRightWidth: 2.5 };
  return <View style={[styles.base, { width: size, height: size, borderColor: color }, corner, style]} />;
}

const styles = StyleSheet.create({
  base: {
    transform: [{ rotate: '45deg' }],
  },
});
