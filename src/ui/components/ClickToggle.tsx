import { useMemo } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from '@/i18n';
import { useThemeColors, type ThemeColors } from '@/ui/theme';

interface ClickToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

/** Mutes/unmutes the synthesized metronome click without touching any track's volume. */
export function ClickToggle({ enabled, onChange }: ClickToggleProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{t.click.heading}</Text>
      <Switch value={enabled} onValueChange={onChange} trackColor={{ false: '#3a3a3c', true: colors.accent }} />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
}
