import { useRef, useState, type ReactNode } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, elevation, radii, spacing } from '@/ui/theme';

export interface OverflowMenuItem {
  key: string;
  label: string;
  onPress: () => void;
  testID?: string;
  /** Highlights this item as the currently-selected one - for a menu that represents a choice (e.g. a language picker), not just a list of actions. */
  active?: boolean;
}

interface Anchor {
  top: number;
  left?: number;
  right?: number;
}

interface OverflowMenuProps {
  items: OverflowMenuItem[];
  /** The trigger's visual content - press feedback (dimming) is applied around it automatically. */
  children: ReactNode;
  /** Which edge the dropdown hangs from - 'end' (right) suits a trailing icon, 'start' (left) suits a full-width row. */
  align?: 'start' | 'end';
  /** Read by screen readers for the trigger; this app never gives it its own visible label. */
  accessibilityLabel: string;
  testID?: string;
}

/**
 * A small dropdown anchored near whatever trigger it wraps - tap an icon or
 * a row, a short list appears right under it (Android's Material menu, iOS's
 * context menu), not a full-width bottom sheet. Built once here so every
 * menu-like control (a header's "...", a settings row that opens a picker)
 * reuses the same trigger/dropdown/dismiss behavior.
 *
 * Rendered through a Modal so it's guaranteed to paint above every other
 * screen element on both platforms without manual zIndex/elevation tuning -
 * that cross-platform stacking behavior is the one genuinely fragile part of
 * a hand-rolled popover, and Modal sidesteps it entirely. Position comes
 * from View.measureInWindow() on the trigger, a long-standing core RN API
 * (not experimental) - no gesture-handler/reanimated/third-party popover
 * library, see AGENTS.md "Stability over appearance". Opening the menu and
 * measuring the trigger are independent on purpose: the Modal opens
 * immediately at a reasonable default position and snaps to the exact spot
 * once the (effectively instant, on a real device) measurement resolves,
 * rather than the menu failing to open at all in an environment where a
 * measurement never comes back (e.g. it doesn't under react-test-renderer,
 * which never fires layout/measurement callbacks - the reason this isn't
 * simply "measure, then open").
 */
export function OverflowMenu({ items, children, align = 'end', accessibilityLabel, testID }: OverflowMenuProps) {
  const triggerRef = useRef<View>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>(() =>
    align === 'end' ? { top: 80, right: spacing.lg } : { top: 80, left: spacing.lg }
  );

  function open() {
    setIsOpen(true);
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor(
        align === 'end'
          ? { top: y + height + 6, right: Math.max(spacing.sm, Dimensions.get('window').width - (x + width)) }
          : { top: y + height + 6, left: x }
      );
    });
  }

  function close() {
    setIsOpen(false);
  }

  function handleSelect(item: OverflowMenuItem) {
    close();
    item.onPress();
  }

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={open}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        {children}
      </Pressable>

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={close}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityLabel={accessibilityLabel}
          testID={testID ? `${testID}-backdrop` : undefined}
        />
        <View style={[styles.menu, anchor]}>
          {items.map((item, index) => (
            <Pressable
              key={item.key}
              onPress={() => handleSelect(item)}
              testID={item.testID}
              style={({ pressed }) => [
                styles.item,
                index < items.length - 1 && styles.itemDivider,
                item.active && styles.itemActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.itemText, item.active && styles.itemTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    </>
  );
}

/** The "..." trigger icon - three dots, drawn with Views rather than a glyph/icon font (see TransportBar for the same convention). */
export function KebabIcon() {
  return (
    <View style={styles.kebab}>
      <View style={styles.kebabDot} />
      <View style={styles.kebabDot} />
      <View style={styles.kebabDot} />
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
  kebab: {
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
  kebabDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textSecondary,
  },
  menu: {
    position: 'absolute',
    minWidth: 180,
    maxWidth: 300,
    borderRadius: radii.lg,
    backgroundColor: colors.panelRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    ...elevation,
  },
  item: {
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  itemDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  itemActive: {
    backgroundColor: 'rgba(32,138,239,0.12)',
  },
  itemTextActive: {
    color: colors.accent,
    fontWeight: '700',
  },
});
