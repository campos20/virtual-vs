import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Chevron } from '@/ui/components/Chevron';
import { spacing, useThemeColors, type ThemeColors } from '@/ui/theme';

interface BackButtonProps {
  label: string;
  onPress: () => void;
  testID?: string;
}

/**
 * The standard "go back" affordance - a chevron + label in the accent
 * color, no background or border, matching iOS's back button / Android's
 * back arrow. Distinct from HeaderButton (a pill-shaped chip), which is for
 * secondary actions like "Edit", not navigation - a back control shouldn't
 * read as an action chip.
 *
 * Press feedback goes through the `style` callback, not a function-as-child
 * - see HeaderButton's comment / AGENTS.md "Stability over appearance" for
 * why a function child re-creating on press-state change can crash Fabric
 * mid-navigation, which this button specifically triggers (router.back()).
 */
export function BackButton({ label, onPress, testID }: BackButtonProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      testID={testID}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
    >
      <Chevron direction="left" style={styles.chevron} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      paddingVertical: 6,
      paddingRight: spacing.sm,
    },
    chevron: {
      marginRight: 4,
    },
    pressed: {
      opacity: 0.5,
    },
    label: {
      color: colors.accent,
      fontSize: 17,
      fontWeight: '600',
    },
  });
}
