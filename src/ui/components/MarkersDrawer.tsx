import { useTranslation } from "@/i18n";
import type { SectionManifest } from "@/types/project";
import { colors, elevation, radii, spacing } from "@/ui/theme";
import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

interface MarkersDrawerProps {
  visible: boolean;
  onClose: () => void;
  sections: SectionManifest[];
  /** Where a new marker would land right now - only used to label the add button. */
  playheadSec: number;
  /** Adds a marker at the current playhead position (the caller captures the exact instant). */
  onAdd: (name: string) => void;
  onRemove: (id: string) => void;
  onJump: (startSec: number) => void;
}

function formatMarkerTime(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = Math.floor(clamped % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Quick-fill labels for the common checkpoints a song is structured around.
 * Tapping one just fills the name field - it's still a plain text field
 * underneath, so a fully custom name works the same way.
 */
const PRESET_KEYS = [
  "presetIntro",
  "presetVerse",
  "presetChorus",
  "presetBridge",
  "presetOutro",
  "presetA",
  "presetB",
] as const;

/**
 * The markers list for the currently playing project: add a checkpoint at
 * wherever the transport is right now, then jump straight back to any of
 * them later. Modal-based, same reasoning as MixerDrawer - guaranteed to
 * paint above everything without manual zIndex tuning, and not gated behind
 * playback the way editing is: adding/removing a marker only rewrites the
 * manifest's `sections` list, it never touches the audio graph (see
 * persistProjectSections).
 */
export function MarkersDrawer({
  visible,
  onClose,
  sections,
  playheadSec,
  onAdd,
  onRemove,
  onJump,
}: MarkersDrawerProps) {
  const { t } = useTranslation();
  const [draftName, setDraftName] = useState("");

  const sorted = [...sections].sort((a, b) => a.startSec - b.startSec);
  const trimmedName = draftName.trim();

  function handleAdd() {
    if (trimmedName.length === 0) return;
    onAdd(trimmedName);
    setDraftName("");
  }

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
        testID="markers-drawer-backdrop"
      />
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t.markers.heading}</Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            testID="close-markers-button"
            style={({ pressed }) => [
              styles.closeButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.closeButtonText}>{t.common.close}</Text>
          </Pressable>
        </View>

        <View style={styles.addSection}>
          <TextInput
            value={draftName}
            onChangeText={setDraftName}
            placeholder={t.markers.namePlaceholder}
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            testID="marker-name-input"
          />
          <View style={styles.presetRow}>
            {PRESET_KEYS.map((key) => (
              <Pressable
                key={key}
                onPress={() => setDraftName(t.markers[key])}
                style={({ pressed }) => [
                  styles.presetChip,
                  pressed && styles.pressed,
                ]}
                testID={`marker-preset-${key}`}
              >
                <Text style={styles.presetChipText}>{t.markers[key]}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={handleAdd}
            disabled={trimmedName.length === 0}
            style={({ pressed }) => [
              styles.addButton,
              trimmedName.length === 0 && styles.addButtonDisabled,
              pressed && styles.pressed,
            ]}
            testID="add-marker-button"
          >
            <Text style={styles.addButtonText}>
              {t.markers.addAt(formatMarkerTime(playheadSec))}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
        >
          {sorted.length === 0 ? (
            <Text style={styles.emptyText}>{t.markers.emptyText}</Text>
          ) : (
            sorted.map((section, idx) => (
              <View key={section.id} style={styles.row}>
                <Pressable
                  style={({ pressed }) => [
                    styles.rowJump,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => onJump(section.startSec)}
                  accessibilityLabel={t.markers.jumpTo(section.name)}
                  testID={`jump-marker-${section.id}`}
                >
                  <Text style={styles.rowName} numberOfLines={1}>
                    {idx + 1}. {section.name}
                  </Text>
                  <Text style={styles.rowTime}>
                    {formatMarkerTime(section.startSec)}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onRemove(section.id)}
                  hitSlop={8}
                  testID={`remove-marker-${section.id}`}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={styles.removeText}>{t.markers.remove}</Text>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    alignItems: "center",
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
  closeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
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
  addSection: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  input: {
    color: colors.textPrimary,
    fontSize: 16,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  presetChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  presetChipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  addButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  addButtonDisabled: {
    opacity: 0.4,
  },
  addButtonText: {
    color: "#0a0a0a",
    fontSize: 15,
    fontWeight: "700",
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 13,
    paddingVertical: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowJump: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginRight: 12,
  },
  rowName: {
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
