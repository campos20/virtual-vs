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
  error?: string | null;
  onAddStems: () => void;
  onRemoveStem: (stemId: string) => void;
  onSubmit: (values: ProjectFormValues) => void;
  onCancel: () => void;
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
  error,
  onAddStems,
  onRemoveStem,
  onSubmit,
  onCancel,
}: ProjectFormProps) {
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
      <Text style={styles.label}>TITLE</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Project title"
        placeholderTextColor={colors.textTertiary}
        style={styles.input}
        testID="title-input"
      />

      <Text style={styles.label}>TEMPO (BPM)</Text>
      <TextInput
        value={bpmText}
        onChangeText={setBpmText}
        keyboardType="number-pad"
        placeholder="Optional — leave empty for no click"
        placeholderTextColor={colors.textTertiary}
        style={styles.input}
        testID="bpm-input"
      />
      <Text style={styles.hint}>
        {bpm === undefined
          ? 'No tempo set, so this project plays without a metronome click.'
          : 'The click is generated from this tempo and sent to the cue (L) bus.'}
      </Text>

      <Text style={styles.label}>KEY</Text>
      <TextInput
        value={key}
        onChangeText={setKey}
        placeholder="e.g. A minor"
        placeholderTextColor={colors.textTertiary}
        style={styles.input}
        testID="key-input"
      />

      <Text style={styles.label}>STEMS</Text>
      <Pressable
        style={({ pressed }) => [styles.pickButton, pressed && styles.pressed]}
        onPress={onAddStems}
        disabled={busy}
        testID="pick-files-button"
      >
        <Text style={styles.pickButtonText}>Add Audio Files…</Text>
      </Pressable>

      {stems.length === 0 ? (
        <Text style={styles.emptyText}>No stems yet.</Text>
      ) : (
        stems.map((stem) => (
          <View key={stem.id} style={styles.fileRow}>
            <Text style={styles.fileName} numberOfLines={1}>
              {stem.name}
            </Text>
            <Pressable
              onPress={() => onRemoveStem(stem.id)}
              hitSlop={8}
              disabled={busy}
              testID={`remove-stem-${stem.id}`}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={styles.removeText}>Remove</Text>
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
          <Text style={styles.submitButtonText}>Save</Text>
        )}
      </Pressable>

      <Pressable
        onPress={onCancel}
        disabled={busy}
        testID="cancel-button"
        style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
      >
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
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
  },
  removeText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
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
});
