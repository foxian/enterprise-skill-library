import { apiErrorMessages, type ApiErrorCode } from '@esl/i18n';
import { resolvePasswordMinLength, type AccountPolicyErrorCode } from '@esl/core';

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

// 领域校验函数（account-policy）用稳定错误码表达失败原因（#145）：取首个失败原因
// 直接作为 API 错误码下发，客户端按 code 翻译，避免把硬编码英文塞进
// validationFailed.detail。泛型约束在编译期保证每个错误码都已登记（ADR-0044）。
export function firstValidationError<C extends ApiErrorCode>(
  errors: C[],
  params: Record<string, string> = {}
): ApiErrorBody {
  return apiError(errors[0], params);
}

// 密码最小长度由部署配置决定：把生效值作为 {min} 参数下发，客户端据此展示与校验。
export function passwordValidationError(
  errors: AccountPolicyErrorCode[],
  minimumLength?: number
): ApiErrorBody {
  return firstValidationError(errors, { min: String(resolvePasswordMinLength(minimumLength)) });
}
