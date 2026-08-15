import { Pressable, StyleSheet, Text, View } from 'react-native';
import { audioEngine } from '@/engine';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { persistProjectMixer } from '@/store/persistProject';
import { trackBusSet, trackEntityId, trackMuteToggled, trackSoloToggled, trackVolumeCommitted } from '@/store/tracksSlice';
import type { Bus, TrackManifest } from '@/types/project';
import { colors, glow, radii } from '@/ui/theme';
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

  // Each of these commits to the store and then writes the whole mixer back
  // to the project's manifest, so the mix is still there next time it opens.
  function handleCommitVolume(volume: number) {
    dispatch(trackVolumeCommitted({ projectId, trackId: track.id, volume }));
    dispatch(persistProjectMixer(projectId));
  }

  function toggleMute() {
    audioEngine.setTrackMuted(track.id, !committed!.muted);
    dispatch(trackMuteToggled({ projectId, trackId: track.id }));
    dispatch(persistProjectMixer(projectId));
  }

  function toggleSolo() {
    audioEngine.setTrackSoloed(track.id, !committed!.soloed);
    dispatch(trackSoloToggled({ projectId, trackId: track.id }));
    dispatch(persistProjectMixer(projectId));
  }

  function setBus(bus: Bus) {
    audioEngine.setTrackBus(track.id, bus);
    dispatch(trackBusSet({ projectId, trackId: track.id, bus }));
    dispatch(persistProjectMixer(projectId));
  }

  return (
    <View style={styles.strip}>
      <View style={[styles.colorBar, { backgroundColor: accentColor }, committed.soloed && glow(accentColor, 8)]} />

      <Text style={styles.name} numberOfLines={2}>
        {track.name}
      </Text>

      <View style={styles.busRow}>
        {BUS_OPTIONS.map(({ value, label }) => {
          const active = committed.bus === value;
          return (
            <Pressable
              key={value}
              onPress={() => setBus(value)}
              style={[styles.busPill, active && { backgroundColor: accentColor }, active && glow(accentColor, 6)]}
            >
              <Text style={[styles.busPillText, active && styles.busPillTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.toggles}>
        <Pressable
          onPress={toggleMute}
          style={[styles.pill, committed.muted && styles.pillMuteActive, committed.muted && glow(colors.danger, 8)]}
        >
          <Text style={styles.pillText}>M</Text>
        </Pressable>
        <Pressable
          onPress={toggleSolo}
          style={[styles.pill, committed.soloed && styles.pillSoloActive, committed.soloed && glow(colors.warning, 8)]}
        >
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
    width: 104,
    marginVertical: 10,
    marginHorizontal: 4,
    paddingBottom: 16,
    paddingTop: 8,
    paddingHorizontal: 8,
    borderRadius: radii.lg,
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.panelRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    overflow: 'hidden',
  },
  colorBar: {
    height: 4,
    alignSelf: 'stretch',
    marginHorizontal: -8,
    marginTop: -8,
  },
  name: {
    color: colors.textPrimary,
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
    backgroundColor: '#08080a',
    borderRadius: radii.sm,
    padding: 3,
  },
  busPill: {
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 5,
    backgroundColor: 'transparent',
  },
  busPillText: {
    color: colors.textSecondary,
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
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.bevelLight,
    borderBottomWidth: 2,
    borderBottomColor: colors.bevelDark,
  },
  pillMuteActive: {
    backgroundColor: colors.danger,
    borderTopColor: 'rgba(255,255,255,0.4)',
  },
  pillSoloActive: {
    backgroundColor: colors.warning,
    borderTopColor: 'rgba(255,255,255,0.4)',
  },
  pillText: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 12,
  },
});
