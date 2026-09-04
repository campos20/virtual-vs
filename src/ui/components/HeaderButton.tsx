import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { radii, spacing, useThemeColors, type ThemeColors } from '@/ui/theme';

interface HeaderButtonProps {
  label: string;
  onPress: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Press feedback goes through Pressable's `style` callback, NOT a
 * function-as-child. A function child re-creates the child Text on every
 * press-state change, so releasing the button re-inserts a text view in the
 * same frame that `onPress` may be tearing the screen down (e.g. via
 * router.back()) - exactly Android's Fabric "addViewAt: ... already has a
 * parent" crash (see AGENTS.md). Styling the Pressable itself only updates
 * props on an already-mounted view and leaves the child tree structurally
 * constant.
 */
export function HeaderButton({ label, onPress, testID, style }: HeaderButtonProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, style, pressed && styles.pressed]}
      hitSlop={8}
      testID={testID}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    button: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radii.pill,
      backgroundColor: colors.borderLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderLight,
    },
    text: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: '700',
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
