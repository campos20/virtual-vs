import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '@/ui/theme';

export interface OverflowMenuItem {
  key: string;
  label: string;
  onPress: () => void;
  testID?: string;
}

interface OverflowMenuProps {
  items: OverflowMenuItem[];
  /** Read by screen readers for the trigger button - this app has no visible label on it. */
  accessibilityLabel: string;
  testID?: string;
}

/**
 * A "..." trigger that opens a bottom sheet of options - built once here so
 * every future menu (this screen's, another screen's, a per-row menu) reuses
 * the same trigger, sheet, and dismiss behavior instead of each screen
 * rolling its own.
 *
 * Plain core RN (Modal + View), no gesture-handler/reanimated and no
 * anchored-dropdown positioning math - see AGENTS.md "Stability over
 * appearance". The backdrop and the sheet are siblings, not nested Pressables
 * - tapping an item or the sheet's own background never also fires the
 * backdrop's dismiss, since only the topmost view under the touch responds.
 */
export function OverflowMenu({ items, accessibilityLabel, testID }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();

  function close() {
    setOpen(false);
  }

  function handleSelect(item: OverflowMenuItem) {
    close();
    item.onPress();
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <View style={styles.dot} />
        <View style={styles.dot} />
        <View style={styles.dot} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.overlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityLabel={accessibilityLabel}
            testID={testID ? `${testID}-backdrop` : undefined}
          />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.sm }]}>
            {items.map((item, index) => (
              <Pressable
                key={item.key}
                onPress={() => handleSelect(item)}
                testID={item.testID}
                style={({ pressed }) => [
                  styles.item,
                  index < items.length - 1 && styles.itemDivider,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.itemText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textSecondary,
  },
  pressed: {
    opacity: 0.7,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingTop: spacing.sm,
    overflow: 'hidden',
  },
  item: {
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
  },
  itemDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
});
