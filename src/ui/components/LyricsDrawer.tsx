import { useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "@/i18n";
import { elevation, radii, spacing, useThemeColors, type ThemeColors } from "@/ui/theme";

const MONOSPACE_FONT = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

interface LyricsDrawerProps {
  visible: boolean;
  onClose: () => void;
  lyrics: string;
  onSave: (lyrics: string) => void;
}

/**
 * The lyrics text editor, modal-based like MarkersDrawer. Unlike Markers'
 * always-empty draft, this must show the project's existing lyrics every
 * time it opens, so the draft is re-seeded from `lyrics` on every
 * visible-false-to-true transition rather than only on first mount.
 *
 * Deliberate deviation from MarkersDrawer: there is no backdrop-tap-to-close
 * here. A marker name is a few characters; losing a large pasted-in lyrics
 * edit to a stray tap outside the sheet is a real cost the marker case never
 * has, so only Close/Save dismiss this drawer.
 */
export function LyricsDrawer({ visible, onClose, lyrics, onSave }: LyricsDrawerProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [draft, setDraft] = useState(lyrics);
  // Re-seeds the draft on every closed-to-open transition, so the drawer
  // always shows the project's current lyrics rather than a stale edit from
  // last time it was open - done during render (React's documented pattern
  // for "adjusting state when a prop changes"), not in a useEffect, so this
  // doesn't cause an extra committed render before the reset is visible.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setDraft(lyrics);
  }

  function handleSave() {
    onSave(draft);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t.lyrics.heading}</Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            testID="close-lyrics-button"
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <Text style={styles.closeButtonText}>{t.common.close}</Text>
          </Pressable>
        </View>

        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t.lyrics.editPlaceholder}
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          multiline
          textAlignVertical="top"
          testID="lyrics-input"
        />
        <Text style={styles.hint}>{t.lyrics.editHint}</Text>

        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
          testID="save-lyrics-button"
        >
          <Text style={styles.saveButtonText}>{t.common.save}</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  sheet: {
    marginTop: "auto",
    height: "85%",
    backgroundColor: colors.panel,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    ...elevation,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
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
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: MONOSPACE_FONT,
    fontSize: 15,
    lineHeight: 22,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  hint: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: spacing.sm,
  },
  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: spacing.md,
  },
  saveButtonText: {
    color: "#0a0a0a",
    fontSize: 16,
    fontWeight: "700",
  },
  });
}
