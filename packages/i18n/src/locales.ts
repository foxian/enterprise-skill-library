export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en-US';

export interface LocaleResolutionInput {
  override?: string | null;
  accountLocale?: string | null;
  browserLanguages?: readonly string[];
}

function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function resolveBrowserLanguage(languages: readonly string[]): Locale | null {
  // 按浏览器偏好顺序逐个 tag 处理：先精确匹配完整 tag，再按语言主标签
  // 匹配（zh-* → zh-CN，en-* → en-US），与 BCP 47 lookup 语义一致。
  for (const tag of languages) {
    if (isSupportedLocale(tag)) return tag;
    const primary = tag.split('-')[0]?.toLowerCase();
    if (primary === 'zh') return 'zh-CN';
    if (primary === 'en') return 'en-US';
  }
  return null;
}

export function resolveLocale(input: LocaleResolutionInput): Locale {
  const override = input.override?.trim();
  if (override && isSupportedLocale(override)) return override;

  const accountLocale = input.accountLocale?.trim();
  if (accountLocale && isSupportedLocale(accountLocale)) return accountLocale;

  if (input.browserLanguages?.length) {
    const browser = resolveBrowserLanguage(input.browserLanguages);
    if (browser) return browser;
  }

  return DEFAULT_LOCALE;
}
