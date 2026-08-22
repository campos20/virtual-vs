import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MonitorMode } from '@/engine';
import { useTranslation } from '@/i18n';
import type { ProjectManifest } from '@/types/project';
import { colors, elevation, radii, spacing } from '@/ui/theme';
import { ChannelStrip } from './ChannelStrip';
import { ClickToggle } from './ClickToggle';
import { HeaderButton } from './HeaderButton';
import { MonitorSplitSwitch } from './MonitorSplitSwitch';

interface MixerDrawerProps {
  visible: boolean;
  onClose: () => void;
  manifest: ProjectManifest;
  monitorMode: MonitorMode;
  onMonitorModeChange: (mode: MonitorMode) => void;
  clickEnabled: boolean;
  onClickEnabledChange: (enabled: boolean) => void;
  /** Omitted for projects that can't be edited (the bundled demo) - matches the old header's `canEdit` check. */
  onEdit?: () => void;
  /**
   * When set, Edit is shown but inert, with this as the explanation. Editing
   * rebuilds the audio graph, so it's unavailable mid-song - saying why beats
   * a button that silently does nothing.
   */
  editDisabledReason?: string;
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
  onEdit,
  editDisabledReason,
}: MixerDrawerProps) {
  const { t } = useTranslation();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel={t.common.close}
        testID="mixer-drawer-backdrop"
      />
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t.project.mixer}</Text>
          <View style={styles.sheetHeaderActions}>
            {/* Living behind the mixer drawer rather than on the main header means it takes a
                deliberate tap to reach, not a stray one during a set - see AGENTS.md-adjacent
                intent: the mixer already exists to keep rarely-touched controls out of the way. */}
            {onEdit &&
              (editDisabledReason ? (
                <Text style={styles.editLocked} testID="edit-locked-reason">
                  {editDisabledReason}
                </Text>
              ) : (
                <HeaderButton label={t.project.edit} onPress={onEdit} testID="edit-button" />
              ))}
            <Pressable
              onPress={onClose}
              hitSlop={8}
              testID="close-mixer-button"
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Text style={styles.closeButtonText}>{t.common.close}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.rack}>
          <MonitorSplitSwitch mode={monitorMode} onChange={onMonitorModeChange} />
          {/* No bpm means no synthesized click, so there is nothing to toggle. */}
          {manifest.bpm !== undefined && (
            <>
              <View style={styles.rackDivider} />
              <ClickToggle enabled={clickEnabled} onChange={onClickEnabledChange} />
            </>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stripsContent}
        >
          {manifest.tracks.map((item, index) => (
            <ChannelStrip key={item.id} projectId={manifest.id} track={item} index={index} />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  editLocked: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
    maxWidth: 160,
    textAlign: 'right',
  },
  sheet: {
    marginTop: 'auto',
    maxHeight: '80%',
    backgroundColor: colors.panel,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...elevation,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sheetTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  sheetHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  closeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
  },
  closeButtonText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
  rack: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rackDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  stripsContent: {
    alignItems: 'stretch',
    paddingHorizontal: 6,
    paddingBottom: spacing.lg,
  },
});
