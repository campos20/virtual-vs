import { Pressable, StyleSheet, Text, View } from 'react-native';
import { audioEngine } from '@/engine';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { trackBusSet, trackEntityId, trackMuteToggled, trackSoloToggled, trackVolumeCommitted } from '@/store/tracksSlice';
import type { Bus, TrackManifest } from '@/types/project';
import { getTrackColor } from '../trackColors';
import { VerticalFader } from './VerticalFader';

// "cue"/"main" are the internal bus identifiers (see types/project.ts) - the
// cue bus is hard-panned left and the main bus hard-panned right (see
// AudioEngine), so L/R is what actually shows up here since that's the
// convention musicians read off a mixer.
const BUS_OPTIONS: { value: Bus; label: string }[] = [
  { value: 'cue', label: 'L' },
  { value: 'main', label: 'R' },
  { value: 'both', label: 'L+R' },
];

interface ChannelStripProps {
  projectId: string;
  track: TrackManifest;
  index: number;
}

export function ChannelStrip({ projectId, track, index }: ChannelStripProps) {
  const dispatch = useAppDispatch();
  const entityId = trackEntityId(projectId, track.id);
  const committed = useAppSelector((s) => s.tracks.entities[entityId]);
  const accentColor = getTrackColor(index);

  if (!committed) return null;

  function handleLiveVolume(volume: number) {
    audioEngine.setTrackVolume(track.id, volume);
  }

  function handleCommitVolume(volume: number) {
    dispatch(trackVolumeCommitted({ projectId, trackId: track.id, volume }));
  }

  function toggleMute() {
    audioEngine.setTrackMuted(track.id, !committed!.muted);
    dispatch(trackMuteToggled({ projectId, trackId: track.id }));
  }

  function toggleSolo() {
    audioEngine.setTrackSoloed(track.id, !committed!.soloed);
    dispatch(trackSoloToggled({ projectId, trackId: track.id }));
  }

  function setBus(bus: Bus) {
    audioEngine.setTrackBus(track.id, bus);
    dispatch(trackBusSet({ projectId, trackId: track.id, bus }));
  }

  return (
    <View style={styles.strip}>
      <View style={[styles.colorBar, { backgroundColor: accentColor }]} />

      <Text style={styles.name} numberOfLines={2}>
        {track.name}
      </Text>

      <View style={styles.busRow}>
        {BUS_OPTIONS.map(({ value, label }) => (
          <Pressable
            key={value}
            onPress={() => setBus(value)}
            style={[styles.busPill, committed.bus === value && { backgroundColor: accentColor }]}
          >
            <Text style={[styles.busPillText, committed.bus === value && styles.busPillTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.toggles}>
        <Pressable onPress={toggleMute} style={[styles.pill, committed.muted && styles.pillMuteActive]}>
          <Text style={styles.pillText}>M</Text>
        </Pressable>
        <Pressable onPress={toggleSolo} style={[styles.pill, committed.soloed && styles.pillSoloActive]}>
          <Text style={styles.pillText}>S</Text>
        </Pressable>
      </View>

      <View style={styles.spacer} />

      <VerticalFader
        value={committed.volume}
        onLiveChange={handleLiveVolume}
        onCommit={handleCommitVolume}
        accentColor={accentColor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    width: 96,
    paddingBottom: 20,
    paddingHorizontal: 8,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#2c2c2e',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0a0a0c',
  },
  colorBar: {
    height: 4,
    alignSelf: 'stretch',
    marginHorizontal: -8,
  },
  name: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    minHeight: 32,
  },
  spacer: {
    flex: 1,
  },
  busRow: {
    flexDirection: 'row',
    gap: 4,
  },
  busPill: {
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: '#1c1c1e',
  },
  busPillText: {
    color: '#8e8e93',
    fontSize: 10,
    fontWeight: '700',
  },
  busPillTextActive: {
    color: '#0a0a0a',
  },
  toggles: {
    flexDirection: 'row',
    gap: 6,
  },
  pill: {
    width: 30,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c1c1e',
  },
  pillMuteActive: {
    backgroundColor: '#ff453a',
  },
  pillSoloActive: {
    backgroundColor: '#ffd60a',
  },
  pillText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
});
