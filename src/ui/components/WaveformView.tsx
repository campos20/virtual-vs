import { ScrollView, StyleSheet, View } from 'react-native';
import { colors } from '@/ui/theme';
import { StemWaveformLane } from './StemWaveformLane';

export interface StemWaveform {
  id: string;
  name: string;
  color: string;
  peaks: Float32Array;
}

interface WaveformViewProps {
  tracks: StemWaveform[];
  durationSec: number;
  playheadSec: number;
}

/**
 * One DAW-style timeline lane per stem, stacked and vertically scrollable so
 * a project with many stems doesn't run out of screen height (see
 * ProjectScreen's `waveformBarCount` call, which caps this at 16 stems).
 * Every lane scrolls horizontally in lockstep
 * because they all share the same duration/bar count and each just follows
 * `playheadSec` independently - see StemWaveformLane. The playhead itself is
 * drawn once here, as a line spanning every lane, rather than per-lane.
 *
 * The vertical ScrollView is a plain, normally-scrollable core `ScrollView`
 * (unlike each lane's horizontal one, which is programmatic-only) - user
 * touch scrolling here is exactly what's wanted for browsing stems.
 */
export function WaveformView({ tracks, durationSec, playheadSec }: WaveformViewProps) {
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.lanes}>
        {tracks.map((track) => (
          <StemWaveformLane
            key={track.id}
            label={track.name}
            color={track.color}
            peaks={track.peaks}
            durationSec={durationSec}
            playheadSec={playheadSec}
          />
        ))}
      </ScrollView>
      <View style={styles.playhead} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  lanes: {
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  playhead: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: colors.textPrimary,
  },
});
