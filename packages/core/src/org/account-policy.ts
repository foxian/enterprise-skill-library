import type { ValidationResult } from '../schema/validation-result.js';

const ACCOUNT_NAME_PATTERN = /^[a-z0-9-]+$/;
const RESERVED_MEMBER_NAMES = new Set(['admin']);
export const DEFAULT_PASSWORD_MIN_LENGTH = 12;
export const MAX_GITEA_USERNAME_LENGTH = 255;

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
    errors.push('member username must be 2-39 characters');
  }
  if (!ACCOUNT_NAME_PATTERN.test(username)) {
    errors.push('member username may only contain lowercase letters, digits, and hyphens');
  }
  if (username.startsWith('-') || username.endsWith('-')) {
    errors.push('member username must not start or end with a hyphen');
  }
  if (RESERVED_MEMBER_NAMES.has(username)) {
    errors.push('member username is reserved');
  }
  return errors.length > 0 ? { success: false, errors } : { success: true, data: username };
}

export function buildGiteaUsername(orgName: string, username: string): string | null {
  const giteaUsername = `${orgName}_${username}`;
  return giteaUsername.length <= MAX_GITEA_USERNAME_LENGTH ? giteaUsername : null;
}

export type OrganizationRole = 'super' | 'org-admin' | 'member';

// 按组织作用域账号模型推导角色:无组织即平台管理员(super);组织内
// 用户名为 admin 即组织管理员(org-admin);其余为普通成员(member)。
// 服务端登录响应以此为准,客户端不再自行推导。
export function deriveOrganizationRole(org: string | null | undefined, username: string): OrganizationRole {
  if (!org) {
    return 'super';
  }
  return username === 'admin' ? 'org-admin' : 'member';
}
