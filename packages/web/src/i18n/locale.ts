import { computed, ref, type ComputedRef } from 'vue';
import { createSharedI18n, type I18nInstance } from '@esl/i18n';
import { DEFAULT_LOCALE, resolveLocale, type Locale } from '@esl/i18n';
import { translateApiError } from '@esl/i18n';
import { apiRequest } from '../api/client';
import { ApiError } from '../api/client';
import { useAuthStore } from '../stores/auth';

const LOCALE_COOKIE = 'esl-locale';

let sharedI18n: I18nInstance | null = null;
let localeOverride = ref<string | null>(null);
let browserLanguages = ref<readonly string[]>([]);

function readLocaleCookie(): string | null {
  const match = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${LOCALE_COOKIE}=`));
  return match?.split('=')[1] ?? null;
}

function writeLocaleCookie(locale: Locale | null): void {
  document.cookie = locale
    ? `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; SameSite=Lax`
    : `${LOCALE_COOKIE}=; path=/; max-age=0`;
}

export async function initializeLocale(options: {
  browserLanguages?: readonly string[];
  cookieLocale?: string | null;
} = {}): Promise<void> {
  localeOverride.value = options.cookieLocale ?? readLocaleCookie();
  browserLanguages.value = options.browserLanguages ?? [...navigator.languages, navigator.language].filter(Boolean);
  sharedI18n = await createSharedI18n(DEFAULT_LOCALE);
}

export interface LocaleState {
  current: ComputedRef<Locale>;
  t: (key: string, options?: Record<string, unknown>) => string;
  formatDate: (value?: string | null) => string;
  formatNumber: (value: number) => string;
  setLocale: (locale: Locale) => Promise<void>;
}

function parseDateValue(value: string): Date {
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

export function useLocaleState(): LocaleState {
  const auth = useAuthStore();
  const current = computed<Locale>(() =>
    resolveLocale({
      override: localeOverride.value,
      accountLocale: auth.accountLocale,
      browserLanguages: browserLanguages.value
    })
  );

  return {
    current,
    t(key, options) {
      if (!sharedI18n) return key;
      return sharedI18n.t(key, { lng: current.value, ...options });
    },
    formatDate(value) {
      if (!value) return '-';
      const date = parseDateValue(value);
      if (Number.isNaN(date.getTime())) return value;
      return new Intl.DateTimeFormat(current.value, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(date);
    },
    formatNumber(value) {
      return new Intl.NumberFormat(current.value).format(value);
    },
    async setLocale(locale) {
      localeOverride.value = locale;
      writeLocaleCookie(locale);
      if (auth.isLoggedIn) {
        try {
          const saved = await apiRequest<{ locale: string | null }>('/api/account/preferences', {
            method: 'PUT',
            body: { locale }
          });
          auth.setLocale(saved.locale);
        } catch {
          // 语言切换先保证界面可用；偏好保存失败不影响本地显示。
        }
      }
    }
  };
}

export function formatRequestError(error: unknown): string {
  const auth = useAuthStore();
  const locale = resolveLocale({
    override: localeOverride.value,
    accountLocale: auth.accountLocale,
    browserLanguages: browserLanguages.value
  });
  if (error instanceof ApiError && error.code) {
    return translateApiError({ locale, code: error.code, params: error.params, fallback: error.message });
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
