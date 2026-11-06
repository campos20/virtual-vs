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
import type { MonitorMode } from "@/engine";
import { useTranslation } from "@/i18n";
import type { ProjectManifest } from "@/types/project";
import {
  elevation,
  radii,
  spacing,
  useThemeColors,
  type ThemeColors,
} from "@/ui/theme";
import { ChannelStrip } from "./ChannelStrip";
import { ClickToggle } from "./ClickToggle";
import { HeaderButton } from "./HeaderButton";
import { MonitorSplitSwitch } from "./MonitorSplitSwitch";

interface MixerDrawerProps {
  visible: boolean;
  onClose: () => void;
  manifest: ProjectManifest;
  monitorMode: MonitorMode;
  onMonitorModeChange: (mode: MonitorMode) => void;
  clickEnabled: boolean;
  onClickEnabledChange: (enabled: boolean) => void;
  /** Packs this project into a `.vvs` bundle and hands it to the share sheet. */
  onExport?: () => void;
}

/**
 * Volume, output routing and the click are all things set once before a set
 * and rarely touched again mid-song, unlike play/pause/seek - so they live
 * behind this drawer instead of always on screen, leaving the main view's
 * space to the waveform. Built on Modal for the same reason as
 * OverflowMenu: guaranteed to paint above everything on both platforms
 * without manual zIndex/elevation tuning, and `animationType="slide"` is a
 * core RN Modal prop, not an animation library (see AGENTS.md "Stability
 * over appearance").
 */
export function MixerDrawer({
  visible,
  onClose,
  manifest,
  monitorMode,
  onMonitorModeChange,
  clickEnabled,
  onClickEnabledChange,
  onExport,
}: MixerDrawerProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

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
        testID="mixer-drawer-backdrop"
      />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t.project.mixer}</Text>
          <View style={styles.sheetHeaderActions}>
            {onExport && (
              <HeaderButton
                label={t.folder.export}
                onPress={onExport}
                testID="export-project-button"
              />
            )}
            <Pressable
              onPress={onClose}
              hitSlop={8}
              testID="close-mixer-button"
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.closeButtonText}>{t.common.close}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.rack}>
          <MonitorSplitSwitch
            mode={monitorMode}
            onChange={onMonitorModeChange}
          />
          {/* No bpm means no synthesized click, so there is nothing to toggle. */}
          {manifest.bpm !== undefined && (
            <>
              <View style={styles.rackDivider} />
              <ClickToggle
                enabled={clickEnabled}
                onChange={onClickEnabledChange}
              />
            </>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stripsContent}
        >
          {manifest.tracks.map((item, index) => (
            <ChannelStrip
              key={item.id}
              projectId={manifest.id}
              track={item}
              index={index}
            />
          ))}
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
    sheetHeaderActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
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
    rack: {
      flexDirection: "row",
      alignItems: "center",
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rackDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: "stretch",
      backgroundColor: colors.border,
      marginVertical: 4,
    },
    stripsContent: {
      alignItems: "stretch",
      paddingHorizontal: 6,
      paddingBottom: spacing.lg,
    },
  });
}
