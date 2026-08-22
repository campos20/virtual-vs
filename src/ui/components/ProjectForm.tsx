import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from '@/i18n';
import { colors, radii, spacing } from '@/ui/theme';

export interface ProjectFormValues {
  title: string;
  /** `undefined` means no tempo, which means the project has no click. */
  bpm?: number;
  key: string;
}

export interface ProjectFormStem {
  id: string;
  name: string;
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
  onSubmit: (values: ProjectFormValues) => void;
  onCancel: () => void;
  /** Omitted for projects that can't be deleted (the bundled demo). */
  onDelete?: () => void;
}

interface StemNameFieldProps {
  stemId: string;
  name: string;
  disabled?: boolean;
  onRename: (stemId: string, name: string) => Promise<boolean>;
}

/**
 * A stem's name, editable in place. Local state (seeded once from `name`)
 * rather than a value fully controlled by the `stems` prop, because that
 * prop is recomputed fresh on every ProjectScreen render (a new array/object
 * per stem) - a fully-controlled input would be fine at rest but risks
 * clobbering an in-progress edit if an unrelated re-render lands mid-type.
 * Committing on blur only (not per keystroke, and not also on
 * `onEndEditing` - a single-line TextInput's default `blurOnSubmit`
 * behavior means submitting already blurs it, so wiring both fires the
 * commit twice for one edit) keeps a manifest rewrite off every character
 * typed and off every edit. Keyed by `stemId` in the parent's `.map()`, so
 * this naturally remounts (and re-seeds) if the stem itself is removed and
 * a different one added in its place.
 */
function StemNameField({ stemId, name, disabled, onRename }: StemNameFieldProps) {
  const [draft, setDraft] = useState(name);

  async function commit() {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed === name) {
      setDraft(name);
      return;
    }
    // Optimistic, but reverted below if the write fails - `onRename` is an
    // async disk write that can fail, and this field is the only thing
    // holding the not-yet-confirmed name, so it can't just keep showing it.
    setDraft(trimmed);
    const persisted = await onRename(stemId, trimmed);
    if (!persisted) setDraft(name);
  }

  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      editable={!disabled}
      underlineColorAndroid="transparent"
      style={styles.fileName}
      testID={`rename-stem-${stemId}`}
    />
  );
}

/**
 * The metadata + stems editor shown inside the project screen. There is no
 * separate "create" variant: a brand-new project is just one with no stems
 * yet, so this same form covers both.
 *
 * Stem add/remove is delegated to the caller because those are real file
 * operations against the project folder, applied as they happen rather than
 * staged behind Save.
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
  onSubmit,
  onCancel,
  onDelete,
}: ProjectFormProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial.title);
  const [bpmText, setBpmText] = useState(initial.bpm === undefined ? '' : String(initial.bpm));
  const [key, setKey] = useState(initial.key);

  const trimmedBpm = bpmText.trim();
  const bpm = trimmedBpm === '' ? undefined : Number(trimmedBpm);
  const bpmValid = bpm === undefined || (Number.isFinite(bpm) && bpm > 0);

  // Stems are written through as they are picked, so an empty project is a
  // perfectly valid thing to save - it just can't be played yet.
  const canSubmit = title.trim().length > 0 && bpmValid && !busy;

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>{t.projectForm.titleLabel}</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder={t.projectForm.titlePlaceholder}
        placeholderTextColor={colors.textTertiary}
        style={styles.input}
        testID="title-input"
      />

      <Text style={styles.label}>{t.projectForm.tempoLabel}</Text>
      <TextInput
        value={bpmText}
        onChangeText={setBpmText}
        keyboardType="number-pad"
        placeholder={t.projectForm.tempoPlaceholder}
        placeholderTextColor={colors.textTertiary}
        style={styles.input}
        testID="bpm-input"
      />
      <Text style={styles.hint}>
        {bpm === undefined ? t.projectForm.tempoHintNone : t.projectForm.tempoHintSet}
      </Text>

      <Text style={styles.label}>{t.projectForm.keyLabel}</Text>
      <TextInput
        value={key}
        onChangeText={setKey}
        placeholder={t.projectForm.keyPlaceholder}
        placeholderTextColor={colors.textTertiary}
        style={styles.input}
        testID="key-input"
      />

      <Text style={styles.label}>{t.projectForm.stemsLabel}</Text>
      <Pressable
        style={({ pressed }) => [styles.pickButton, pressed && styles.pressed]}
        onPress={onAddStems}
        disabled={busy}
        testID="pick-files-button"
      >
        <Text style={styles.pickButtonText}>{t.projectForm.addAudioFiles}</Text>
      </Pressable>

      {busy && status ? (
        <View style={styles.statusRow} testID="import-status">
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : null}

      {stems.length === 0 ? (
        <Text style={styles.emptyText}>{t.projectForm.noStemsYet}</Text>
      ) : (
        stems.map((stem) => (
          <View key={stem.id} style={styles.fileRow}>
            <StemNameField
              stemId={stem.id}
              name={stem.name}
              disabled={busy}
              onRename={onRenameStem}
            />
            <Pressable
              onPress={() => onRemoveStem(stem.id)}
              hitSlop={8}
              disabled={busy}
              testID={`remove-stem-${stem.id}`}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={styles.removeText}>{t.projectForm.remove}</Text>
            </Pressable>
          </View>
        ))
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={({ pressed }) => [
          styles.submitButton,
          !canSubmit && styles.submitButtonDisabled,
          pressed && styles.pressed,
        ]}
        onPress={() => onSubmit({ title: title.trim(), bpm, key: key.trim() })}
        disabled={!canSubmit}
        testID="save-button"
      >
        {busy ? (
          <ActivityIndicator color="#0a0a0a" />
        ) : (
          <Text style={styles.submitButtonText}>{t.common.save}</Text>
        )}
      </Pressable>

      <Pressable
        onPress={onCancel}
        disabled={busy}
        testID="cancel-button"
        style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
      >
        <Text style={styles.cancelText}>{t.common.cancel}</Text>
      </Pressable>

      {onDelete && (
        <Pressable
          onPress={onDelete}
          disabled={busy}
          testID="delete-project-button"
          style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
        >
          <Text style={styles.deleteText}>{t.projectForm.deleteProject}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 40,
    gap: 6,
  },
  label: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 12,
  },
  input: {
    color: colors.textPrimary,
    fontSize: 16,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  hint: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 4,
  },
  pressed: {
    opacity: 0.7,
  },
  pickButton: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  pickButtonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fileName: {
    color: colors.textPrimary,
    fontSize: 14,
    flex: 1,
    marginRight: 12,
    padding: 0,
  },
  removeText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: 13,
    flex: 1,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 13,
    paddingVertical: 10,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    marginTop: 12,
  },
  submitButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  submitButtonDisabled: {
    opacity: 0.4,
  },
  submitButtonText: {
    color: '#0a0a0a',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  deleteButton: {
    marginTop: 32,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
  },
  deleteText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '700',
  },
});
