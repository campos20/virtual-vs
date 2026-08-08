import { StyleSheet, Switch, Text, View } from 'react-native';
import type { MonitorMode } from '@/engine';

interface MonitorSplitSwitchProps {
  mode: MonitorMode;
  onChange: (mode: MonitorMode) => void;
}

/**
 * "Split" hard-pans cue to the left channel / main to the right, for a TRS
 * Y-split cable feeding in-ears (cue/L) and FOH (main/R). "Monitor" sums
 * both buses to both channels for rehearsing on normal headphones.
 */
export function MonitorSplitSwitch({ mode, onChange }: MonitorSplitSwitchProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>OUTPUT</Text>
      <View style={styles.row}>
        <Text style={[styles.label, mode === 'split' && styles.labelActive]}>Split (L / R)</Text>
        <Switch
          value={mode === 'monitor'}
          onValueChange={(isMonitor) => onChange(isMonitor ? 'monitor' : 'split')}
          trackColor={{ false: '#3a3a3c', true: '#208AEF' }}
        />
        <Text style={[styles.label, mode === 'monitor' && styles.labelActive]}>Monitor (sum)</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2c2c2e',
  },
  heading: {
    color: '#5f5f63',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  label: {
    color: '#8e8e93',
    fontSize: 13,
    fontWeight: '600',
  },
  labelActive: {
    color: '#ffffff',
  },
});
