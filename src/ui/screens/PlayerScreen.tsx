import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { audioEngine, type EngineTransportState, type TrackRuntimeState } from '@/engine';
import { usePlayhead } from '@/hooks/usePlayhead';
import { decodeProjectAudio, getProjectSourceForEntry } from '@/storage';
import { store } from '@/store';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { projectsSelectors } from '@/store/projectsSlice';
import { monitorModeSet } from '@/store/settingsSlice';
import { tracksInitializedForProject, tracksSelectors, trackEntityId } from '@/store/tracksSlice';
import type { ProjectManifest } from '@/types/project';
import { ChannelStrip } from '@/ui/components/ChannelStrip';
import { MonitorSplitSwitch } from '@/ui/components/MonitorSplitSwitch';
import { TransportBar } from '@/ui/components/TransportBar';

export function PlayerScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const dispatch = useAppDispatch();
  const entry = useAppSelector((s) => (projectId ? projectsSelectors.selectById(s.projects, projectId) : undefined));
  const monitorMode = useAppSelector((s) => s.settings.monitorMode);

  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transportState, setTransportState] = useState<EngineTransportState>('stopped');

  const { seconds: playheadSec } = usePlayhead();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!entry) return;
      setLoading(true);
      setError(null);
      try {
        const source = await getProjectSourceForEntry(entry);
        const decoded = await decodeProjectAudio(audioEngine.context, source);
        if (cancelled) return;

        dispatch(tracksInitializedForProject({ projectId: entry.id, tracks: source.manifest.tracks }));

        const tracksState = store.getState().tracks;
        const initialTrackStates: Record<string, TrackRuntimeState> = {};
        for (const track of source.manifest.tracks) {
          const committed = tracksSelectors.selectById(tracksState, trackEntityId(entry.id, track.id));
          if (committed) {
            initialTrackStates[track.id] = {
              id: track.id,
              bus: committed.bus,
              volume: committed.volume,
              muted: committed.muted,
              soloed: committed.soloed,
            };
          }
        }

        audioEngine.loadProject(decoded, initialTrackStates);
        audioEngine.setMonitorMode(monitorMode);

        const longestBufferSec = source.manifest.tracks.reduce(
          (max, t) => Math.max(max, decoded.trackBuffers[t.id]?.duration ?? 0),
          0
        );

        setDurationSec(longestBufferSec);
        setManifest(source.manifest);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      audioEngine.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- monitorMode intentionally only applied on (re)load
  }, [entry?.id, dispatch]);

  // The engine drives natural end-of-playback itself (see AudioEngine.handlePlaybackEndedNaturally)
  // and notifies us here, rather than this component polling playheadSec against durationSec.
  useEffect(() => {
    return audioEngine.onTransportStateChange(setTransportState);
  }, []);

  function handlePlayPause() {
    if (audioEngine.getTransportState() === 'playing') {
      audioEngine.pause();
    } else {
      audioEngine.play();
    }
  }

  function handleStop() {
    audioEngine.stop();
  }

  function handleSeek(seconds: number) {
    audioEngine.seek(seconds);
  }

  function handleMonitorModeChange(mode: typeof monitorMode) {
    audioEngine.setMonitorMode(mode);
    dispatch(monitorModeSet(mode));
  }

  if (!entry) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.error}>Project not found.</Text>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color="#208AEF" />
      </SafeAreaView>
    );
  }

  if (error || !manifest) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.error}>{error ?? 'Failed to load project.'}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{manifest.title}</Text>
        <Text style={styles.subtitle}>
          {manifest.bpm} BPM · {manifest.key}
        </Text>
      </View>

      <View style={styles.mixer}>
        <FlatList
          horizontal
          data={manifest.tracks}
          keyExtractor={(t) => t.id}
          renderItem={({ item, index }) => <ChannelStrip projectId={manifest.id} track={item} index={index} />}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.mixerContent}
        />
      </View>

      <View style={styles.console}>
        <MonitorSplitSwitch mode={monitorMode} onChange={handleMonitorModeChange} />
        <TransportBar
          isPlaying={transportState === 'playing'}
          playheadSec={playheadSec}
          durationSec={durationSec}
          onPlayPause={handlePlayPause}
          onStop={handleStop}
          onSeek={handleSeek}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  centered: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: '#8e8e93',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  mixer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  mixerContent: {
    // Strips stretch to fill the mixer area so the console reads as one
    // continuous surface instead of floating above empty space.
    alignItems: 'stretch',
  },
  console: {
    backgroundColor: '#0c0c0e',
  },
  error: {
    color: '#ff453a',
    fontSize: 15,
  },
});
