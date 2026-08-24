import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, elevation, glow, radii, spacing } from '@/ui/theme';
import { MoveColumn } from './MoveColumn';
import { KebabIcon, OverflowMenu, type OverflowMenuItem } from './OverflowMenu';

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
  /** This is the project currently loaded in the engine (see nowPlayingStore) - highlighted so it reads apart from the rest of the list. */
  isNowPlaying?: boolean;
  nowPlayingAccessibilityLabel?: string;
  /** Row-level actions (add to a folder, remove from one). Omitted means no kebab at all. */
  menuItems?: OverflowMenuItem[];
  menuAccessibilityLabel?: string;
  /** Indents the row and drops its shadow, for a song shown inside a folder. */
  nested?: boolean;
  /**
   * 1-based position within its folder. A folder is a setlist, and a setlist
   * is read by position - "we're on 4" - so the number is what the row is
   * found by on stage, not decoration. Omitted at the top level, where there
   * is no set to be fourth in.
   */
  position?: number;
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
  isNowPlaying,
  nowPlayingAccessibilityLabel,
  menuItems,
  menuAccessibilityLabel,
  nested,
  position,
  testID,
}: ProjectRowProps) {
  return (
    <View style={[styles.container, nested && styles.nested]}>
      <Pressable
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View
          style={[
            styles.colorBar,
            { backgroundColor: accentColor },
            isNowPlaying && glow(accentColor, 8),
          ]}
        />
        {position !== undefined && (
          <Text
            style={styles.position}
            // Fixed width + tabular figures so the titles stay aligned as the
            // count crosses into double digits mid-set.
            testID={testID ? `${testID}-position` : undefined}
          >
            {position}
          </Text>
        )}
        <View style={styles.rowBody}>
          <View style={styles.titleRow}>
            {isNowPlaying && (
              <View
                style={[styles.nowPlayingDot, glow(colors.accent, 6)]}
                accessible
                accessibilityRole="image"
                accessibilityLabel={nowPlayingAccessibilityLabel}
                testID={testID ? `${testID}-now-playing` : undefined}
              />
            )}
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          </View>
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

      {menuItems && menuItems.length > 0 && (
        <View style={styles.menuColumn}>
          <OverflowMenu
            items={menuItems}
            accessibilityLabel={menuAccessibilityLabel ?? ''}
            testID={testID ? `${testID}-menu` : undefined}
          >
            <KebabIcon />
          </OverflowMenu>
        </View>
      )}

      <MoveColumn
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        moveUpAccessibilityLabel={moveUpAccessibilityLabel}
        moveDownAccessibilityLabel={moveDownAccessibilityLabel}
        testID={testID}
      />
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
  position: {
    color: colors.textTertiary,
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    minWidth: 18,
    marginRight: spacing.sm,
    textAlign: 'right',
  },
  rowBody: {
    flex: 1,
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nowPlayingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    flexShrink: 1,
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
  nested: {
    // Reads as contained by the folder above it rather than as another
    // top-level row: pulled in from the left, flatter, no drop shadow.
    marginLeft: spacing.lg,
    backgroundColor: colors.panelRaised,
    shadowOpacity: 0,
    elevation: 0,
  },
  menuColumn: {
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  chevron: {
    color: colors.textTertiary,
    fontSize: 22,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
});
