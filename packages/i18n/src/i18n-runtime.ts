import i18next, { type i18n } from 'i18next';
import { DEFAULT_LOCALE, type Locale } from './locales.js';
import { translationResources } from './resources.js';

export type { i18n };

export async function createSharedI18n(initialLocale: Locale = DEFAULT_LOCALE): Promise<i18n> {
  const instance = i18next.createInstance();
  await instance.init({
    lng: initialLocale,
    fallbackLng: 'zh-CN',
    resources: {
      'zh-CN': { translation: translationResources['zh-CN'] },
      'en-US': { translation: translationResources['en-US'] }
    },
    interpolation: { escapeValue: false }
  });
  return instance;
}
