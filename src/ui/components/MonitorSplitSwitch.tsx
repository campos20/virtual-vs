import { StyleSheet, Switch, Text, View } from 'react-native';
import type { MonitorMode } from '@/engine';
import { colors } from '@/ui/theme';

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
        <Text style={[styles.label, mode === 'split' && styles.labelActive]}>Split</Text>
        <Switch
          value={mode === 'monitor'}
          onValueChange={(isMonitor) => onChange(isMonitor ? 'monitor' : 'split')}
          trackColor={{ false: '#3a3a3c', true: colors.accent }}
        />
        <Text style={[styles.label, mode === 'monitor' && styles.labelActive]}>Sum</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  heading: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    minWidth: 30,
  },
  labelActive: {
    color: colors.textPrimary,
  },
});
