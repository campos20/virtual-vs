import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, elevation, radii, spacing } from '@/ui/theme';

interface ProjectRowProps {
  title: string;
  bpm?: number;
  musicalKey: string;
  accentColor: string;
  stemsLabel: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPress: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  moveUpAccessibilityLabel: string;
  moveDownAccessibilityLabel: string;
  testID?: string;
}

/**
 * A Library row, with explicit move-up/move-down buttons for reordering
 * rather than a drag gesture. A hand-rolled drag (PanResponder inside a
 * ScrollView, negotiating touch responder priority against a sibling
 * Pressable) has real gesture-arbitration edge cases that are hard to fully
 * verify without a real device - the safer, fully-deterministic choice is
 * two ordinary buttons, each just swapping this row with its neighbor. See
 * AGENTS.md "Stability over appearance".
 */
export function ProjectRow({
  title,
  bpm,
  musicalKey,
  accentColor,
  stemsLabel,
  canMoveUp,
  canMoveDown,
  onPress,
  onMoveUp,
  onMoveDown,
  moveUpAccessibilityLabel,
  moveDownAccessibilityLabel,
  testID,
}: ProjectRowProps) {
  return (
    <View style={styles.container}>
      <Pressable
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={[styles.colorBar, { backgroundColor: accentColor }]} />
        <View style={styles.rowBody}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.metaRow}>
            {bpm !== undefined && (
              <View style={styles.metaPill}>
                <Text style={styles.metaPillText}>{bpm} BPM</Text>
              </View>
            )}
            <View style={styles.metaPill}>
              <Text style={styles.metaPillText}>{musicalKey || '—'}</Text>
            </View>
            <View style={styles.metaPill}>
              <Text style={styles.metaPillText}>{stemsLabel}</Text>
            </View>
          </View>
        </View>
        {/* No Edit affordance here: opening a project *is* how you edit it
            now - the project screen carries its own Edit button next to the
            mixer. */}
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      <View style={styles.moveColumn}>
        <Pressable
          onPress={onMoveUp}
          disabled={!canMoveUp}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={moveUpAccessibilityLabel}
          testID={testID ? `${testID}-move-up` : undefined}
          style={({ pressed }) => [styles.moveButton, pressed && canMoveUp && styles.pressed]}
        >
          <View style={[styles.arrowUp, !canMoveUp && styles.arrowDisabled]} />
        </Pressable>
        <Pressable
          onPress={onMoveDown}
          disabled={!canMoveDown}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={moveDownAccessibilityLabel}
          testID={testID ? `${testID}-move-down` : undefined}
          style={({ pressed }) => [styles.moveButton, pressed && canMoveDown && styles.pressed]}
        >
          <View style={[styles.arrowDown, !canMoveDown && styles.arrowDisabled]} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    ...elevation,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  colorBar: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginRight: spacing.md,
  },
  rowBody: {
    flex: 1,
    gap: 8,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    gap: 6,
  },
  metaPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  metaPillText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  chevron: {
    color: colors.textTertiary,
    fontSize: 22,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
  moveColumn: {
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  moveButton: {
    width: 40,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowUp: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.textSecondary,
  },
  arrowDown: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colors.textSecondary,
  },
  arrowDisabled: {
    opacity: 0.25,
  },
});
