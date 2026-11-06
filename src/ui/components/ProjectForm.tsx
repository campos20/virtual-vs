import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "@/i18n";
import { radii, spacing, useThemeColors, type ThemeColors } from "@/ui/theme";
import { getTrackColor } from "@/ui/trackColors";
import { MoveColumn } from "./MoveColumn";
import { StemOverview } from "./StemOverview";

export interface ProjectFormValues {
  title: string;
  /** `undefined` means no tempo, which means the project has no click. */
  bpm?: number;
  key: string;
}

export interface ProjectFormStem {
  id: string;
  name: string;
  /** Whole-song waveform peaks, when the project is loaded - drawn as the track's region. */
  peaks?: Float32Array;
}

interface ProjectFormProps {
  initial: ProjectFormValues;
  stems: ProjectFormStem[];
  busy?: boolean;
  /** What the busy work is currently doing, shown next to the spinner. */
  status?: string | null;
  error?: string | null;
  onAddStems: () => void;
  onRemoveStem: (stemId: string) => void;
  /** Resolves to whether the rename actually persisted, so a failed write doesn't leave the field showing an unsaved name. */
  onRenameStem: (stemId: string, name: string) => Promise<boolean>;
  onMoveStem: (stemId: string, direction: "up" | "down") => void;
  /** A move is still saving - the arrows wait for it, so moves never overlap. */
  movesDisabled?: boolean;
  onSubmit: (values: ProjectFormValues) => void;
  onCancel: () => void;
  /** Omitted for a project that can't be deleted. */
  onDelete?: () => void;
}

const LANE_HEIGHT = 64;
const OVERVIEW_HEIGHT = 40;

interface StemNameFieldProps {
  stemId: string;
  name: string;
  accessibilityLabel: string;
  disabled?: boolean;
  onRename: (stemId: string, name: string) => Promise<boolean>;
  styles: ReturnType<typeof createStyles>;
}

/**
 * A track's name, editable in place - drawn as a visible input box, the way a
 * DAW's track header name field is, so it reads as something you can tap and
 * type into rather than as a plain label.
 *
 * Local state (seeded once from `name`) rather than a value fully controlled
 * by the `stems` prop, because that prop is recomputed fresh on every
 * ProjectScreen render (a new array/object per stem) - a fully-controlled
 * input would be fine at rest but risks clobbering an in-progress edit if an
 * unrelated re-render lands mid-type. Committing on blur only (not per
 * keystroke, and not also on `onEndEditing` - a single-line TextInput's
 * default `blurOnSubmit` behavior means submitting already blurs it, so
 * wiring both fires the commit twice for one edit) keeps a manifest rewrite
 * off every character typed. Keyed by `stemId` in the parent's `.map()`, so it
 * keeps its state when the track moves and remounts if the stem itself is
 * removed and a different one added in its place.
 */
function StemNameField({
  stemId,
  name,
  accessibilityLabel,
  disabled,
  onRename,
  styles,
}: StemNameFieldProps) {
  const [draft, setDraft] = useState(name);
  const [focused, setFocused] = useState(false);
  /** The last name a rename actually saved - what a failed rename reverts to. */
  const confirmedRef = useRef(name);
  /** The newest rename still saving, if any. Only it may touch the field. */
  const latestRef = useRef<{ attempt: number; name: string } | null>(null);
  const attemptsRef = useRef(0);

  async function commit() {
    setFocused(false);
    const trimmed = draft.trim();
    // What the field should show at rest: the name being saved, else the
    // last saved one. Blurring without a change saves nothing.
    const current = latestRef.current?.name ?? confirmedRef.current;
    if (trimmed.length === 0 || trimmed === current) {
      setDraft(current);
      return;
    }
    // Optimistic, but reverted below if the write fails - `onRename` is an
    // async disk write that can fail, and this field is the only thing
    // holding the not-yet-confirmed name, so it can't just keep showing it.
    const attempt = ++attemptsRef.current;
    latestRef.current = { attempt, name: trimmed };
    setDraft(trimmed);
    const persisted = await onRename(stemId, trimmed);
    // Manifest writes run one at a time, in order (see withManifestLock), so
    // results land oldest first and this tracks what's actually on disk.
    if (persisted) confirmedRef.current = trimmed;
    // A newer rename was started while this one saved - the field is its
    // business now. Rolling back here would show an older name than the
    // one that ends up saved.
    if (latestRef.current?.attempt !== attempt) return;
    latestRef.current = null;
    // Revert to the last saved name, not the one this field started with -
    // and only if the field still shows this attempt, so text typed since
    // isn't thrown away.
    if (!persisted) {
      setDraft((shown) => (shown === trimmed ? confirmedRef.current : shown));
    }
  }

  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onFocus={() => setFocused(true)}
      onBlur={commit}
      editable={!disabled}
      selectTextOnFocus
      returnKeyType="done"
      autoCorrect={false}
      underlineColorAndroid="transparent"
      accessibilityLabel={accessibilityLabel}
      style={[styles.nameField, focused && styles.nameFieldFocused]}
      testID={`rename-stem-${stemId}`}
    />
  );
}

/**
 * The song editor shown inside the project screen, laid out like a DAW's
 * session view: a song-info strip (title, tempo, key) on top, then one lane
 * per track - colour, number, name, a zoomed-out region of its audio, and
 * its move/remove controls - with "Add Tracks" closing the list the way an
 * empty slot does in a DAW. Cancel/Done stay pinned at the bottom so they're
 * reachable however long the track list gets.
 *
 * There is no separate "create" variant: a brand-new project is just one
 * with no stems yet, so this same editor covers both.
 *
 * Track add/remove/rename/move is delegated to the caller because those are
 * real file operations against the project folder, applied as they happen
 * rather than staged behind Done. Only the song info waits for Done.
 *
 * Every Pressable keeps static children with press feedback in `style` - see
 * AGENTS.md on Fabric and function-as-child Pressables.
 */
export function ProjectForm({
  initial,
  stems,
  busy = false,
  status,
  error,
  onAddStems,
  onRemoveStem,
  onRenameStem,
  onMoveStem,
  movesDisabled = false,
  onSubmit,
  onCancel,
  onDelete,
}: ProjectFormProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [title, setTitle] = useState(initial.title);
  const [bpmText, setBpmText] = useState(
    initial.bpm === undefined ? "" : String(initial.bpm),
  );
  const [key, setKey] = useState(initial.key);

  const trimmedBpm = bpmText.trim();
  const bpm = trimmedBpm === "" ? undefined : Number(trimmedBpm);
  const bpmValid = bpm === undefined || (Number.isFinite(bpm) && bpm > 0);

  // Stems are written through as they are picked, so an empty project is a
  // perfectly valid thing to save - it just can't be played yet.
  const canSubmit = title.trim().length > 0 && bpmValid && !busy;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionLabel}>{t.projectForm.songSection}</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>{t.projectForm.titleLabel}</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={t.projectForm.titlePlaceholder}
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            testID="title-input"
          />
          <View style={styles.fieldRow}>
            <View style={styles.fieldTempo}>
              <Text style={styles.fieldLabel}>{t.projectForm.tempoLabel}</Text>
              <TextInput
                value={bpmText}
                onChangeText={setBpmText}
                keyboardType="number-pad"
                placeholder="—"
                placeholderTextColor={colors.textTertiary}
                style={[styles.input, !bpmValid && styles.inputInvalid]}
                testID="bpm-input"
              />
            </View>
            <View style={styles.fieldKey}>
              <Text style={styles.fieldLabel}>{t.projectForm.keyLabel}</Text>
              <TextInput
                value={key}
                onChangeText={setKey}
                placeholder={t.projectForm.keyPlaceholder}
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
                testID="key-input"
              />
            </View>
          </View>
          <Text style={styles.hint}>
            {bpm === undefined
              ? t.projectForm.tempoHintNone
              : t.projectForm.tempoHintSet}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>
          {t.projectForm.tracksSection(stems.length)}
        </Text>
        <View style={styles.trackList} testID="track-list">
          {stems.length === 0 ? (
            <Text style={styles.emptyText}>{t.projectForm.noStemsYet}</Text>
          ) : (
            stems.map((stem, index) => {
              const color = getTrackColor(index);
              const isFirst = index === 0;
              const isLast = index === stems.length - 1;
              return (
                <View
                  key={stem.id}
                  style={[styles.lane, index % 2 === 1 && styles.laneAlt]}
                  testID={`track-lane-${stem.id}`}
                >
                  <View
                    style={[styles.laneColor, { backgroundColor: color }]}
                  />
                  <View style={styles.laneHeader}>
                    <Text style={styles.laneNumber}>{index + 1}</Text>
                    <StemNameField
                      stemId={stem.id}
                      name={stem.name}
                      accessibilityLabel={t.projectForm.trackNameLabel(
                        index + 1,
                      )}
                      disabled={busy}
                      onRename={onRenameStem}
                      styles={styles}
                    />
                  </View>
                  <View style={styles.laneRegion}>
                    <StemOverview
                      color={color}
                      peaks={stem.peaks}
                      height={OVERVIEW_HEIGHT}
                    />
                  </View>
                  <MoveColumn
                    canMoveUp={!busy && !movesDisabled && !isFirst}
                    canMoveDown={!busy && !movesDisabled && !isLast}
                    onMoveUp={() => onMoveStem(stem.id, "up")}
                    onMoveDown={() => onMoveStem(stem.id, "down")}
                    moveUpAccessibilityLabel={t.projectForm.moveTrackUp(
                      stem.name,
                    )}
                    moveDownAccessibilityLabel={t.projectForm.moveTrackDown(
                      stem.name,
                    )}
                    testID={`stem-${stem.id}`}
                  />
                  <Pressable
                    onPress={() => onRemoveStem(stem.id)}
                    disabled={busy}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityLabel={t.projectForm.removeTrack(stem.name)}
                    testID={`remove-stem-${stem.id}`}
                    style={({ pressed }) => [
                      styles.removeButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.removeGlyph}>✕</Text>
                  </Pressable>
                </View>
              );
            })
          )}

          <Pressable
            style={({ pressed }) => [
              styles.addLane,
              busy && styles.disabled,
              pressed && styles.pressed,
            ]}
            onPress={onAddStems}
            disabled={busy}
            testID="pick-files-button"
          >
            <Text style={styles.addLaneText}>{t.projectForm.addTracks}</Text>
          </Pressable>
        </View>

        {busy && status ? (
          <View style={styles.statusRow} testID="import-status">
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.statusText}>{status}</Text>
          </View>
        ) : null}

        {stems.length > 0 && (
          <Text style={styles.hint}>{t.projectForm.tracksHint}</Text>
        )}

        {onDelete && (
          <Pressable
            onPress={onDelete}
            disabled={busy}
            testID="delete-project-button"
            style={({ pressed }) => [
              styles.deleteButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.deleteText}>{t.projectForm.deleteProject}</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.footerButtons}>
          <Pressable
            onPress={onCancel}
            disabled={busy}
            testID="cancel-button"
            style={({ pressed }) => [
              styles.cancelButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.cancelText}>{t.common.cancel}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.submitButton,
              !canSubmit && styles.disabled,
              pressed && styles.pressed,
            ]}
            onPress={() =>
              onSubmit({ title: title.trim(), bpm, key: key.trim() })
            }
            disabled={!canSubmit}
            testID="save-button"
          >
            {busy ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.submitButtonText}>{t.projectForm.done}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xl,
    },
    sectionLabel: {
      color: colors.textTertiary,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 1,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    card: {
      backgroundColor: colors.panel,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.md,
      gap: 6,
    },
    fieldRow: {
      flexDirection: "row",
      gap: spacing.md,
      marginTop: spacing.xs,
    },
    fieldTempo: {
      width: 96,
      gap: 6,
    },
    fieldKey: {
      flex: 1,
      gap: 6,
    },
    fieldLabel: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.5,
    },
    input: {
      color: colors.textPrimary,
      fontSize: 16,
      backgroundColor: colors.surface,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    inputInvalid: {
      borderColor: colors.danger,
    },
    hint: {
      color: colors.textTertiary,
      fontSize: 12,
      marginTop: spacing.sm,
    },
    trackList: {
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
      backgroundColor: colors.background,
    },
    lane: {
      flexDirection: "row",
      alignItems: "center",
      height: LANE_HEIGHT,
      backgroundColor: colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    laneAlt: {
      backgroundColor: colors.panel,
    },
    laneColor: {
      width: 5,
      alignSelf: "stretch",
    },
    // Like WaveformView's track header: a raised block left of the region.
    laneHeader: {
      width: 148,
      alignSelf: "stretch",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 6,
      backgroundColor: colors.panelRaised,
      borderRightWidth: 1,
      borderRightColor: colors.border,
    },
    laneNumber: {
      width: 18,
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: "800",
      textAlign: "center",
      fontVariant: ["tabular-nums"],
    },
    nameField: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: "700",
      backgroundColor: colors.surface,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    nameFieldFocused: {
      borderColor: colors.accent,
    },
    laneRegion: {
      flex: 1,
      paddingHorizontal: spacing.sm,
    },
    removeButton: {
      width: 40,
      alignSelf: "stretch",
      alignItems: "center",
      justifyContent: "center",
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.border,
    },
    removeGlyph: {
      color: colors.danger,
      fontSize: 16,
      fontWeight: "700",
    },
    addLane: {
      height: 48,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.panel,
    },
    addLaneText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: "700",
    },
    emptyText: {
      color: colors.textTertiary,
      fontSize: 13,
      padding: spacing.lg,
      textAlign: "center",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: spacing.md,
    },
    statusText: {
      color: colors.textSecondary,
      fontSize: 13,
      flex: 1,
    },
    pressed: {
      opacity: 0.6,
    },
    disabled: {
      opacity: 0.4,
    },
    deleteButton: {
      marginTop: 40,
      paddingVertical: 14,
      alignItems: "center",
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.danger,
    },
    deleteText: {
      color: colors.danger,
      fontSize: 15,
      fontWeight: "700",
    },
    footer: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      backgroundColor: colors.panel,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    footerButtons: {
      flexDirection: "row",
      gap: spacing.md,
    },
    error: {
      color: colors.danger,
      fontSize: 13,
      marginBottom: spacing.sm,
    },
    cancelButton: {
      flex: 1,
      paddingVertical: 13,
      alignItems: "center",
      borderRadius: radii.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cancelText: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: "600",
    },
    submitButton: {
      flex: 2,
      backgroundColor: colors.accent,
      borderRadius: radii.lg,
      paddingVertical: 13,
      alignItems: "center",
    },
    submitButtonText: {
      color: "#0a0a0a",
      fontSize: 16,
      fontWeight: "700",
    },
  });
}
