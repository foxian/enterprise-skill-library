import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_NAME_MAX_LENGTH,
  ACCOUNT_NAME_MIN_LENGTH,
  ACCOUNT_POLICY_ERRORS,
  DEFAULT_PASSWORD_MIN_LENGTH,
  RESERVED_SCOPE_NAMES,
  giteaUserEmail,
  resolvePasswordMinLength,
  validateMemberUsername,
  validateOrgName,
  validatePassword,
  validateSkillUserEmail
} from '../src/index.js';

const RESERVED_NAMES = ['local', 'builtin', 'admin', 'api', 'git', 'system'];

function errorsOf(result: { success: boolean; errors?: string[] }): string[] {
  return result.errors ?? [];
}

describe('flat scope name pool', () => {
  it('exposes the reserved names that constrain both usernames and organization names', () => {
    expect([...RESERVED_SCOPE_NAMES].sort()).toEqual([...RESERVED_NAMES].sort());
  });

  it('rejects reserved names as organization names', () => {
    for (const name of RESERVED_NAMES) {
      expect(validateOrgName(name).success).toBe(false);
    }
  });

  it('rejects reserved names as usernames', () => {
    for (const name of RESERVED_NAMES) {
      expect(validateMemberUsername(name).success).toBe(false);
    }
  });
});

describe('organization name validation', () => {
  it('accepts valid organization names', () => {
    for (const name of ['acme', 'platform-ai', 'a1', 'ab', 'a'.repeat(39)]) {
      expect(validateOrgName(name).success).toBe(true);
    }
  });

  it('rejects names that are too short or too long', () => {
    expect(validateOrgName('a').success).toBe(false);
    expect(validateOrgName('a'.repeat(40)).success).toBe(false);
  });

  it('rejects names containing characters other than lowercase letters, digits, and hyphens', () => {
    expect(validateOrgName('Acme').success).toBe(false);
    expect(validateOrgName('acme_corp').success).toBe(false);
    expect(validateOrgName('acme corp').success).toBe(false);
  });

  it('rejects names starting or ending with a hyphen', () => {
    expect(validateOrgName('-acme').success).toBe(false);
    expect(validateOrgName('acme-').success).toBe(false);
  });

  it('rejects reserved system names', () => {
    for (const name of ['admin', 'api', 'git', 'system', 'local', 'builtin']) {
      expect(validateOrgName(name).success).toBe(false);
    }
  });

  it('returns descriptive error messages', () => {
    const result = validateOrgName('acme_corp');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(' ')).toMatch(/lowercase letters, digits, and hyphens/);
    }
  });
});

describe('account and password policy', () => {
  it('accepts passwords at or above the configured minimum length', () => {
    expect(validatePassword('a'.repeat(8), 8).success).toBe(true);
    expect(validatePassword('a'.repeat(20), 8).success).toBe(true);
    expect(validatePassword('a'.repeat(12), 12).success).toBe(true);
    expect(validatePassword('a'.repeat(20), 12).success).toBe(true);
  });

  it('rejects passwords below the configured minimum length', () => {
    const result = validatePassword('a'.repeat(7), 8);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toEqual([ACCOUNT_POLICY_ERRORS.passwordTooShort]);
    }
    const configured = validatePassword('a'.repeat(11), 12);
    expect(configured.success).toBe(false);
  });

  it('defaults to the shared minimum length of 8', () => {
    expect(DEFAULT_PASSWORD_MIN_LENGTH).toBe(8);
    expect(validatePassword('a'.repeat(7)).success).toBe(false);
    expect(validatePassword('a'.repeat(8)).success).toBe(true);
  });

  it('validates local member usernames with the organization naming alphabet', () => {
    expect(validateMemberUsername('alice').success).toBe(true);
    expect(validateMemberUsername('platform-ai').success).toBe(true);
    expect(validateMemberUsername('abc').success).toBe(false);
    expect(validateMemberUsername('abcd').success).toBe(true);
    expect(validateMemberUsername('admin').success).toBe(false);
    expect(validateMemberUsername('Alice').success).toBe(false);
    expect(validateMemberUsername('alice_user').success).toBe(false);
  });

  // 失败原因用稳定错误码表达（#145、#146）：服务端直接下发错误码，Web 注册页
  // 复用同一套错误码做本地预校验后的字段级提示。
  it('reports stable error codes for invalid usernames', () => {
    expect(errorsOf(validateMemberUsername('abc'))).toEqual([ACCOUNT_POLICY_ERRORS.usernameLength]);
    expect(errorsOf(validateMemberUsername('Alice'))).toEqual([ACCOUNT_POLICY_ERRORS.usernameAlphabet]);
    expect(errorsOf(validateMemberUsername('-alice'))).toEqual([ACCOUNT_POLICY_ERRORS.usernameHyphen]);
    expect(errorsOf(validateMemberUsername('admin'))).toEqual([ACCOUNT_POLICY_ERRORS.usernameReserved]);
  });

  it('reports stable error codes for invalid Skill User Emails', () => {
    expect(errorsOf(validateSkillUserEmail('not-an-email'))).toEqual([ACCOUNT_POLICY_ERRORS.emailInvalid]);
    expect(errorsOf(validateSkillUserEmail('dave@local.esl'))).toEqual([ACCOUNT_POLICY_ERRORS.emailDomainReserved]);
  });

  it('exposes the shared username length bounds consumed by the Web registration hints', () => {
    expect(ACCOUNT_NAME_MIN_LENGTH).toBe(4);
    expect(ACCOUNT_NAME_MAX_LENGTH).toBe(39);
  });

  // 密码最小长度只有一个权威来源（#146）：服务端下发与 Web 提示都经它解析。
  it('resolves the effective password minimum length in one place', () => {
    expect(resolvePasswordMinLength()).toBe(DEFAULT_PASSWORD_MIN_LENGTH);
    expect(resolvePasswordMinLength(12)).toBe(12);
    expect(giteaUserEmail('alice')).toBe('alice@local.esl');
  });

});
