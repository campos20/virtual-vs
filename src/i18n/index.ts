import { useMemo } from 'react';
import { useLocales } from 'expo-localization';
import { useAppSelector } from '@/store/hooks';
import { en, type TranslationDictionary } from './en';
import { ptBR } from './pt-BR';

export type Locale = 'en' | 'pt-BR';

const dictionaries: Record<Locale, TranslationDictionary> = {
  en,
  'pt-BR': ptBR,
};

/** Only Portuguese gets its own locale for now; everything else falls back to English. */
export function resolveLocale(languageCode: string | null | undefined): Locale {
  return languageCode === 'pt' ? 'pt-BR' : 'en';
}

/**
 * Reactive to the device's locale via expo-localization's useLocales() -
 * Android can change the system language without restarting the app; iOS
 * only picks a change up on next launch, per the OS itself - unless the user
 * picked a language explicitly on the About screen, which wins regardless of
 * the device.
 */
export function useTranslation() {
  const locales = useLocales();
  const override = useAppSelector((s) => s.settings.languageOverride);
  const deviceLocale = resolveLocale(locales[0]?.languageCode);
  const locale = override ?? deviceLocale;
  const t = useMemo(() => dictionaries[locale], [locale]);
  return { t, locale };
}
