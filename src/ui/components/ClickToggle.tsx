import { StyleSheet, Switch, Text, View } from 'react-native';

interface ClickToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

/** Mutes/unmutes the synthesized metronome click without touching any track's volume. */
export function ClickToggle({ enabled, onChange }: ClickToggleProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>CLICK</Text>
      <Switch value={enabled} onValueChange={onChange} trackColor={{ false: '#3a3a3c', true: '#208AEF' }} />
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
});
