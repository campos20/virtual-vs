import { useState } from 'react';
import { getDocumentAsync, type DocumentPickerAsset } from 'expo-document-picker';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createProjectFromStems } from '@/storage';
import { useAppDispatch } from '@/store/hooks';
import { projectAdded } from '@/store/projectsSlice';

const DEFAULT_BPM = '120';

export function NewProjectScreen() {
  const dispatch = useAppDispatch();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [bpmText, setBpmText] = useState(DEFAULT_BPM);
  const [files, setFiles] = useState<DocumentPickerAsset[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bpm = Number(bpmText);
  const canCreate = title.trim().length > 0 && files.length > 0 && Number.isFinite(bpm) && bpm > 0 && !creating;

  async function handlePickFiles() {
    const result = await getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;

    setFiles((prev) => {
      const existingUris = new Set(prev.map((f) => f.uri));
      const additions = result.assets.filter((f) => !existingUris.has(f.uri));
      return [...prev, ...additions];
    });
  }

  function handleRemoveFile(uri: string) {
    setFiles((prev) => prev.filter((f) => f.uri !== uri));
  }

  async function handleCreate() {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const entry = await createProjectFromStems({ title: title.trim(), bpm, files });
      dispatch(projectAdded(entry));
      router.replace({ pathname: '/player/[projectId]', params: { projectId: entry.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} testID="cancel-button">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>New Project</Text>
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

        <Text style={styles.label}>STEMS</Text>
        <Pressable style={styles.pickButton} onPress={handlePickFiles} testID="pick-files-button">
          <Text style={styles.pickButtonText}>Select Audio Files…</Text>
        </Pressable>

        <FlatList
          data={files}
          keyExtractor={(f) => f.uri}
          style={styles.fileList}
          renderItem={({ item }) => (
            <View style={styles.fileRow}>
              <Text style={styles.fileName} numberOfLines={1}>
                {item.name}
              </Text>
              <Pressable onPress={() => handleRemoveFile(item.uri)} hitSlop={8}>
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No files selected yet.</Text>}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.createButton, !canCreate && styles.createButtonDisabled]}
          onPress={handleCreate}
          disabled={!canCreate}
          testID="create-project-button"
        >
          {creating ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.createButtonText}>Create Project</Text>}
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
  pickButton: {
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  pickButtonText: {
    color: '#208AEF',
    fontSize: 15,
    fontWeight: '600',
  },
  fileList: {
    marginTop: 8,
    maxHeight: 220,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  fileName: {
    color: '#ffffff',
    fontSize: 14,
    flex: 1,
    marginRight: 12,
  },
  removeText: {
    color: '#ff453a',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyText: {
    color: '#5f5f63',
    fontSize: 13,
    paddingVertical: 10,
  },
  error: {
    color: '#ff453a',
    fontSize: 13,
    marginTop: 12,
  },
  createButton: {
    backgroundColor: '#208AEF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  createButtonDisabled: {
    opacity: 0.4,
  },
  createButtonText: {
    color: '#0a0a0a',
    fontSize: 16,
    fontWeight: '700',
  },
});
