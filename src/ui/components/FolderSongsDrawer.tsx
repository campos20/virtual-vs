import { useTranslation } from "@/i18n";
import type { LibraryProjectEntry } from "@/store/projectsSlice";
import { elevation, radii, spacing, useThemeColors, type ThemeColors } from "@/ui/theme";
import { useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface FolderSongsDrawerProps {
  visible: boolean;
  onClose: () => void;
  folderName: string;
  songs: LibraryProjectEntry[];
  currentProjectId?: string;
  onJump: (projectId: string) => void;
  /** Omitted (rather than a no-op) when the current song is last in the folder - disables the footer button instead of hiding it, so it doesn't move around from song to song. */
  onPlayNext?: () => void;
}

/**
 * The full list of songs in the folder the current one was opened from -
 * hidden by default, opened only by its own icon (see ProjectScreen's
 * header, in its own button group away from Markers/Mixer), never a one-tap
 * control. That's deliberate: switching songs from inside a live set is
 * exactly the kind of action a stray tap must never trigger by accident, so
 * it's gated behind an extra, explicit step - open the list, then tap the
 * specific song wanted - rather than a quick prev/next that could fire from
 * a mis-tap.
 *
 * A right-anchored side panel rather than a bottom sheet like
 * MarkersDrawer/MixerDrawer - this one is a *list to browse*, closer to a
 * navigation drawer than a quick-action tray, and reads that way sliding in
 * from the edge. `animationType="fade"` instead of `Modal`'s own "slide":
 * that transition is a native full-screen cover-from-the-bottom regardless
 * of where the content inside ends up, so pairing it with a panel that only
 * occupies the right edge would visibly slide the whole screen up before
 * settling into a right-anchored rectangle - a fade sidesteps that mismatch
 * without hand-rolling a custom slide animation (see AGENTS.md "Stability
 * over appearance" on preferring the plain, already-reliable option).
 */
export function FolderSongsDrawer({
  visible,
  onClose,
  folderName,
  songs,
  currentProjectId,
  onJump,
  onPlayNext,
}: FolderSongsDrawerProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  function handlePress(projectId: string) {
    // Already viewing it - nothing to jump to, just dismiss the list.
    if (projectId === currentProjectId) {
      onClose();
      return;
    }
    onJump(projectId);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel={t.common.close}
        testID="folder-songs-drawer-backdrop"
      />
      <SafeAreaView edges={["top", "bottom", "right"]} style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle} numberOfLines={1}>
            {folderName}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            testID="close-folder-songs-button"
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <Text style={styles.closeButtonText}>{t.common.close}</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {songs.map((song, index) => {
            const isCurrent = song.id === currentProjectId;
            return (
              <Pressable
                key={song.id}
                onPress={() => handlePress(song.id)}
                testID={`folder-songs-row-${song.id}`}
                accessibilityLabel={isCurrent ? t.nowPlaying.heading : undefined}
                style={({ pressed }) => [
                  styles.row,
                  isCurrent && styles.rowCurrent,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.rowPosition}>{index + 1}</Text>
                <Text
                  style={[styles.rowName, isCurrent && styles.rowNameCurrent]}
                  numberOfLines={1}
                >
                  {song.title}
                </Text>
                {isCurrent && <View style={styles.nowPlayingDot} testID={`folder-songs-row-${song.id}-now-playing`} />}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={onPlayNext}
            disabled={!onPlayNext}
            testID="play-next-song-button"
            style={({ pressed }) => [
              styles.playNextButton,
              !onPlayNext && styles.playNextButtonDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.playNextButtonText}>{t.project.playNextSong}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    panel: {
      marginLeft: "auto",
      width: "82%",
      maxWidth: 360,
      // Without an explicit height, this shrinks to fit its content (header
      // + footer) instead of filling the screen - the list's `flex: 1` then
      // has nothing to grow into and collapses to nothing, leaving only the
      // footer button visible.
      height: "100%",
      backgroundColor: colors.panel,
      borderTopLeftRadius: radii.xl,
      borderBottomLeftRadius: radii.xl,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      ...elevation,
    },
    panelHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    panelTitle: {
      flex: 1,
      marginRight: spacing.sm,
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
    list: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowCurrent: {
      backgroundColor: colors.borderLight,
      marginHorizontal: -spacing.lg,
      paddingHorizontal: spacing.lg,
    },
    rowPosition: {
      color: colors.textTertiary,
      fontSize: 15,
      fontWeight: "800",
      fontVariant: ["tabular-nums"],
      minWidth: 20,
      textAlign: "right",
    },
    rowName: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: "600",
    },
    rowNameCurrent: {
      fontWeight: "800",
    },
    nowPlayingDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.accent,
    },
    // Pinned below the ScrollView (a sibling, not part of its scrollable
    // content) so it always stays reachable at the bottom of the panel
    // regardless of scroll position or how many songs the folder holds.
    footer: {
      padding: spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    playNextButton: {
      backgroundColor: colors.accent,
      borderRadius: radii.md,
      paddingVertical: 14,
      alignItems: "center",
    },
    playNextButtonDisabled: {
      opacity: 0.4,
    },
    playNextButtonText: {
      // Not a fixed dark color: `colors.accent` is a brighter blue in dark
      // mode and a darker one in light mode, so a hardcoded near-black
      // reads fine on the former but low-contrast/odd on the latter.
      // `colors.surface` happens to invert the same way accent does (dark
      // in dark mode, light in light mode), so it stays legible in both.
      color: colors.surface,
      fontSize: 15,
      fontWeight: "700",
    },
  });
}
