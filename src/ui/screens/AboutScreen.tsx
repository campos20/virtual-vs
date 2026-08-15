import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { HeaderButton } from '@/ui/components/HeaderButton';
import { colors, radii, spacing } from '@/ui/theme';

const DEVELOPER = 'campos20';
const GITHUB_URL = 'https://github.com/campos20/virtual-vs';
const LICENSE = 'GPL-3.0-or-later';

export function AboutScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const version = Constants.expoConfig?.version;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <HeaderButton label={t.project.backToLibrary} onPress={() => router.back()} testID="about-back-button" />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>VIRTUAL VS</Text>
        <Text style={styles.title}>{t.about.title}</Text>
        <Text style={styles.developedBy}>{t.about.developedBy(DEVELOPER)}</Text>

        {version && <Text style={styles.meta}>{t.about.version(version)}</Text>}

        <Pressable
          onPress={() => openBrowserAsync(GITHUB_URL)}
          style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          testID="about-github-link"
        >
          <Text style={styles.linkText}>{t.about.viewOnGithub}</Text>
        </Pressable>

        <Text style={styles.license}>
          {t.about.license}: {LICENSE}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: 80,
    gap: 6,
  },
  eyebrow: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 4,
  },
  developedBy: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 4,
  },
  meta: {
    color: colors.textTertiary,
    fontSize: 13,
    marginTop: 2,
  },
  linkRow: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(32,138,239,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(32,138,239,0.5)',
  },
  linkText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
  license: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: spacing.xl,
  },
});
