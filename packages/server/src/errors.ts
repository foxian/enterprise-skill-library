import { apiErrorMessages, type ApiErrorCode } from '@esl/i18n';

export interface ApiErrorBody {
  code: ApiErrorCode;
  params: Record<string, string>;
  message: string;
}

function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => params[key] ?? placeholder);
}

// API 错误契约（ADR-0044）：code 稳定，message 为固定英文兜底，客户端按 code 翻译。
export function apiError(
  code: ApiErrorCode,
  params: Record<string, string> = {}
): ApiErrorBody {
  return { code, params, message: interpolate(apiErrorMessages[code], params) };
}
