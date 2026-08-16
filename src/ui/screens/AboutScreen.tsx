import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type Locale, useTranslation } from '@/i18n';
import { persistLanguageOverride } from '@/store/persistSettings';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { BackButton } from '@/ui/components/BackButton';
import { Chevron } from '@/ui/components/Chevron';
import { OverflowMenu, type OverflowMenuItem } from '@/ui/components/OverflowMenu';
import { colors, radii, spacing } from '@/ui/theme';

const DEVELOPER = 'campos20';
const GITHUB_URL = 'https://github.com/campos20/virtual-vs';
const LICENSE = 'GPL-3.0-or-later';

type LanguageKey = 'system' | Locale;

const LANGUAGE_FLAGS: Record<LanguageKey, string> = {
  system: '🌐',
  en: '🇺🇸',
  'pt-BR': '🇧🇷',
};

// Named in their own language, regardless of the app's current language -
// the standard convention (iOS/Android system pickers, most apps) is that
// "Português (Brasil)" reads the same whether browsing from English or
// Portuguese, so a reader can always find their own language.
const LANGUAGE_NAMES: Record<Locale, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
};

export function AboutScreen() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const languageOverride = useAppSelector((s) => s.settings.languageOverride);
  const version = Constants.expoConfig?.version;

  const currentKey: LanguageKey = languageOverride ?? 'system';
  const currentLabel = currentKey === 'system' ? t.about.languageSystem : LANGUAGE_NAMES[currentKey];

  const languageMenuItems: OverflowMenuItem[] = (['system', 'en', 'pt-BR'] as const).map((key) => ({
    key,
    label: `${LANGUAGE_FLAGS[key]} ${key === 'system' ? t.about.languageSystem : LANGUAGE_NAMES[key]}`,
    onPress: () => dispatch(persistLanguageOverride(key === 'system' ? null : key)),
    testID: `language-option-${key}`,
    active: key === currentKey,
  }));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <BackButton label={t.project.backToLibrary} onPress={() => router.back()} testID="about-back-button" />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
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
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>{t.about.language}</Text>
          <OverflowMenu
            items={languageMenuItems}
            align="start"
            accessibilityLabel={t.about.language}
            testID="about-language-menu"
          >
            <View style={styles.languageTrigger}>
              <Text style={styles.languageTriggerValue}>
                {LANGUAGE_FLAGS[currentKey]} {currentLabel}
              </Text>
              <Chevron direction="right" size={8} color={colors.textTertiary} />
            </View>
          </OverflowMenu>
        </View>

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
    paddingHorizontal: spacing.lg,
    paddingBottom: 80,
    gap: spacing.xl,
  },
  hero: {
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
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
  section: {
    gap: spacing.sm,
  },
  sectionHeading: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  languageTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  languageTriggerValue: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  license: {
    color: colors.textTertiary,
    fontSize: 12,
    textAlign: 'center',
  },
});
