import { useMemo } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "@/i18n";
import type { LyricsSyncPoint } from "@/types/project";
import { elevation, radii, spacing, useThemeColors, type ThemeColors } from "@/ui/theme";

interface LyricsSyncDrawerProps {
  visible: boolean;
  onClose: () => void;
  lyrics: string;
  syncPoints: LyricsSyncPoint[];
  onRemoveOne: (lineIndex: number) => void;
  onClearAll: () => void;
}

function formatSyncTime(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = Math.floor(clamped % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Management view for the lyrics view's tap-to-sync corrections, opened via
 * the toolbar's Sync button - mirrors MarkersDrawer's list-with-remove
 * pattern. *Adding* a correction still only happens by tapping a line
 * directly on the scrolling lyrics view (that's the whole "tap it as it
 * drifts by" interaction the feature is built around, see LyricsView); this
 * drawer is purely for reviewing what's been tapped so far and removing a
 * mistake, one at a time or all at once - keeping that always-visible from
 * the main reading view would clutter it, so it moved here.
 */
export function LyricsSyncDrawer({
  visible,
  onClose,
  lyrics,
  syncPoints,
  onRemoveOne,
  onClearAll,
}: LyricsSyncDrawerProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const lines = lyrics.split("\n");
  const sorted = [...syncPoints].sort((a, b) => a.timeSec - b.timeSec);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel={t.common.close}
        testID="lyrics-sync-drawer-backdrop"
      />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <View>
            <Text style={styles.sheetTitle}>{t.lyrics.syncHeading}</Text>
            <Text style={styles.sheetSubtitle}>{t.lyrics.syncCount(syncPoints.length)}</Text>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            testID="close-lyrics-sync-button"
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <Text style={styles.closeButtonText}>{t.common.close}</Text>
          </Pressable>
        </View>

        {sorted.length > 0 && (
          <Pressable
            onPress={onClearAll}
            testID="clear-all-sync-button"
            style={({ pressed }) => [styles.clearAllButton, pressed && styles.pressed]}
          >
            <Text style={styles.clearAllText}>{t.lyrics.clearSync}</Text>
          </Pressable>
        )}

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {sorted.length === 0 ? (
            <Text style={styles.emptyText}>{t.lyrics.tapHint}</Text>
          ) : (
            sorted.map((point) => (
              <View key={point.lineIndex} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowLine} numberOfLines={1}>
                    {lines[point.lineIndex]?.trim() || `#${point.lineIndex + 1}`}
                  </Text>
                  <Text style={styles.rowTime}>{formatSyncTime(point.timeSec)}</Text>
                </View>
                <Pressable
                  onPress={() => onRemoveOne(point.lineIndex)}
                  hitSlop={8}
                  testID={`remove-sync-${point.lineIndex}`}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={styles.removeText}>{t.lyrics.remove}</Text>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  sheet: {
    marginTop: "auto",
    maxHeight: "80%",
    backgroundColor: colors.panel,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...elevation,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sheetTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "800",
  },
  sheetSubtitle: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.borderLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  closeButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.7,
  },
  clearAllButton: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: 10,
    borderRadius: radii.md,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
  },
  clearAllText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: "700",
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    // Extra room at the bottom of the scrollable list, same reasoning as
    // MarkersDrawer's listContent - without it the last row's Remove button
    // sits flush against the sheet's bottom edge.
    paddingBottom: spacing.xl,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 13,
    paddingVertical: spacing.md,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowText: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginRight: 12,
  },
  rowLine: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
    marginRight: 8,
  },
  rowTime: {
    color: colors.textSecondary,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  removeText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "600",
  },
  });
}
