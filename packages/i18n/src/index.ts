export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  resolveLocale,
  type Locale,
  type LocaleResolutionInput
} from './locales.js';
export {
  translationResources,
  validateTranslationParity,
  type TranslationResources
} from './resources.js';
export {
  apiErrorMessages,
  apiErrorMessagesZhCN,
  type ApiErrorCode
} from './api-errors.js';
export {
  translateApiError,
  type TranslateApiErrorInput
} from './translate-api-error.js';
export {
  createSharedI18n,
  type i18n as I18nInstance
} from './i18n-runtime.js';
