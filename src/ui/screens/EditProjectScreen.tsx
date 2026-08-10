import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { updateProjectMetadata } from '@/storage';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { projectUpdated, projectsSelectors } from '@/store/projectsSlice';

export function EditProjectScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const dispatch = useAppDispatch();
  const router = useRouter();

  const entry = useAppSelector((s) =>
    projectId ? projectsSelectors.selectById(s.projects, projectId) : undefined
  );

  const [title, setTitle] = useState(entry?.title ?? '');
  const [bpmText, setBpmText] = useState(entry ? String(entry.bpm) : '');
  const [key, setKey] = useState(entry?.key ?? '');
  const [countInBarsText, setCountInBarsText] = useState(entry ? String(entry.countInBars) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bpm = Number(bpmText);
  const countInBars = Number(countInBarsText);
  const canSave =
    title.trim().length > 0 &&
    Number.isFinite(bpm) &&
    bpm > 0 &&
    Number.isFinite(countInBars) &&
    countInBars >= 0 &&
    !saving;

  async function handleSave() {
    if (!entry?.sourceDir || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      await updateProjectMetadata(entry.sourceDir, { title: title.trim(), bpm, key: key.trim(), countInBars });
      dispatch(projectUpdated({ id: entry.id, changes: { title: title.trim(), bpm, key: key.trim(), countInBars } }));
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  if (!entry || entry.origin === 'bundled') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} testID="cancel-button">
            <Text style={styles.cancelText}>Close</Text>
          </Pressable>
          <Text style={styles.title}>Edit Project</Text>
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.notice}>
          {entry ? "The bundled demo project can't be edited." : 'Project not found.'}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} testID="cancel-button">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Edit Project</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>TITLE</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Project title"
          placeholderTextColor="#5f5f63"
          style={styles.input}
          testID="title-input"
        />

        <Text style={styles.label}>TEMPO (BPM)</Text>
        <TextInput
          value={bpmText}
          onChangeText={setBpmText}
          keyboardType="number-pad"
          style={styles.input}
          testID="bpm-input"
        />

        <Text style={styles.label}>KEY</Text>
        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder="e.g. A minor"
          placeholderTextColor="#5f5f63"
          style={styles.input}
          testID="key-input"
        />

        <Text style={styles.label}>COUNT-IN (BARS)</Text>
        <TextInput
          value={countInBarsText}
          onChangeText={setCountInBarsText}
          keyboardType="number-pad"
          style={styles.input}
          testID="count-in-input"
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!canSave}
          testID="save-button"
        >
          {saving ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.saveButtonText}>Save Changes</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  cancelText: {
    color: '#208AEF',
    fontSize: 15,
    fontWeight: '600',
  },
  headerSpacer: {
    width: 60,
  },
  title: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  notice: {
    color: '#8e8e93',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 40,
    paddingHorizontal: 24,
  },
  form: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 6,
  },
  label: {
    color: '#5f5f63',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 12,
  },
  input: {
    color: '#ffffff',
    fontSize: 16,
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  error: {
    color: '#ff453a',
    fontSize: 13,
    marginTop: 12,
  },
  saveButton: {
    backgroundColor: '#208AEF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    color: '#0a0a0a',
    fontSize: 16,
    fontWeight: '700',
  },
});
