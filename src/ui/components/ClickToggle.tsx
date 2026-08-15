import { StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '@/ui/theme';

interface ClickToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

/** Mutes/unmutes the synthesized metronome click without touching any track's volume. */
export function ClickToggle({ enabled, onChange }: ClickToggleProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>CLICK</Text>
      <Switch value={enabled} onValueChange={onChange} trackColor={{ false: '#3a3a3c', true: colors.accent }} />
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
});
