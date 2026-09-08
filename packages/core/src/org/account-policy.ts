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

// Git Backend 用户账号的 email 约定(用户创建流程统一使用该格式):以该 email
// 作为 commit author 时,Git Backend 可通过 email 把提交匹配到对应账号。
export function giteaUserEmail(giteaUsername: string): string {
  return `${giteaUsername}@local.esl`;
}

// 组织作用域账号名的逆向解析(ADR-0020):组织名与成员用户名都不允许下划线,
// 首个下划线即唯一分隔点。平台管理员等无组织账号不含下划线,解析返回 null。
export function parseGiteaUsername(giteaUsername: string): { org: string; username: string } | null {
  const separator = giteaUsername.indexOf('_');
  if (separator <= 0 || separator === giteaUsername.length - 1) {
    return null;
  }
  return {
    org: giteaUsername.slice(0, separator),
    username: giteaUsername.slice(separator + 1)
  };
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
