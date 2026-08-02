import { useStore } from '@/services/store';
import { getDateFnsLocale, getIntlLocale, translateText } from '@/i18n/messages';

export function useI18n() {
  const language = useStore((state) => state.language || 'zh-CN');
  const locale = getIntlLocale(language);

  return {
    language,
    locale,
    dateFnsLocale: getDateFnsLocale(language),
    tx: (text: string, vars?: Record<string, string | number>) => translateText(language, text, vars),
    formatDate: (value: Date, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, options).format(value),
    formatTime: (value: Date, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, options).format(value),
  };
}
