import type { Locale } from './locales.js';
import { apiErrorMessagesZhCN } from './api-errors.js';

export interface TranslateApiErrorInput {
  locale: Locale;
  code: string;
  params?: Record<string, string>;
  fallback: string;
}

function interpolate(template: string, params: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => params[key] ?? placeholder);
}

export function translateApiError(input: TranslateApiErrorInput): string {
  if (input.locale === 'zh-CN') {
    const template = apiErrorMessagesZhCN[input.code as keyof typeof apiErrorMessagesZhCN];
    if (template) return interpolate(template, input.params);
  }
  return interpolate(input.fallback, input.params);
}
