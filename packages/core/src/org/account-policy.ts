import type { ValidationResult } from '../schema/validation-result.js';

const ACCOUNT_NAME_PATTERN = /^[a-z0-9-]+$/;

// 扁平命名池的保留名（ADR-0032）：用户名与组织名共用同一约束，
// 保证保留 scope 与系统路径永远可用。
export const RESERVED_SCOPE_NAMES: ReadonlySet<string> = new Set([
  'local',
  'builtin',
  'admin',
  'api',
  'git',
  'system'
]);
export const DEFAULT_PASSWORD_MIN_LENGTH = 8;

export function validatePassword(
  password: string,
  minimumLength = DEFAULT_PASSWORD_MIN_LENGTH
): ValidationResult<string> {
  if (password.length < minimumLength) {
    return {
      success: false,
      errors: [`password must be at least ${minimumLength} characters`]
    };
  }
  return { success: true, data: password };
}

export function validateMemberUsername(username: string): ValidationResult<string> {
  const errors: string[] = [];
  if (username.length < 2 || username.length > 39) {
    errors.push('username must be 2-39 characters');
  }
  if (!ACCOUNT_NAME_PATTERN.test(username)) {
    errors.push('username may only contain lowercase letters, digits, and hyphens');
  }
  if (username.startsWith('-') || username.endsWith('-')) {
    errors.push('username must not start or end with a hyphen');
  }
  if (RESERVED_SCOPE_NAMES.has(username)) {
    errors.push('username is reserved');
  }
  return errors.length > 0 ? { success: false, errors } : { success: true, data: username };
}


// Git Backend 用户账号的 email 约定(用户创建流程统一使用该格式):以该 email
// 作为 commit author 时,Git Backend 可通过 email 把提交匹配到对应账号。
export function giteaUserEmail(giteaUsername: string): string {
  return `${giteaUsername}@local.esl`;
}


