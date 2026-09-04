import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useThemeColors } from '@/ui/theme';

interface ChevronProps {
  direction?: 'left' | 'right';
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A "‹"/"›" arrow drawn from a rotated bordered corner, not a glyph/icon
 * font - see TransportBar's play triangle/pause bars for the same
 * convention (plain Views, not text glyphs or an icon library). `color`
 * defaults to the current theme's accent rather than a fixed value, so a
 * caller that doesn't pass one explicitly still tracks light/dark.
 */
export function Chevron({ direction = 'right', color, size = 9, style }: ChevronProps) {
  const colors = useThemeColors();
  const resolvedColor = color ?? colors.accent;
  const corner =
    direction === 'left'
      ? { borderLeftWidth: 2.5, borderBottomWidth: 2.5 }
      : { borderTopWidth: 2.5, borderRightWidth: 2.5 };
  return (
    <View style={[styles.base, { width: size, height: size, borderColor: resolvedColor }, corner, style]} />
  );
}

const styles = StyleSheet.create({
  base: {
    transform: [{ rotate: '45deg' }],
  },
});
