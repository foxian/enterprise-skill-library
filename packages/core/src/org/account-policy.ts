const ACCOUNT_NAME_PATTERN = /^[a-z0-9-]+$/;
const SKILL_USER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
export const ACCOUNT_NAME_MIN_LENGTH = 4;
export const ACCOUNT_NAME_MAX_LENGTH = 39;
export const DEFAULT_PASSWORD_MIN_LENGTH = 8;
const SKILL_USER_EMAIL_RESERVED_DOMAIN = 'local.esl';

// 账号约束的失败原因用稳定错误码表达（ADR-0044）：服务端把它直接作为 API 错误码
// 下发，Web 注册页也用它做本地预校验后的字段级提示，两端共用同一套文案与规则，
// 不再下发硬编码英文 detail（#145、#146）。
export const ACCOUNT_POLICY_ERRORS = {
  usernameLength: 'usernameMustBe4To39Characters',
  usernameAlphabet: 'usernameMayOnlyContainLowercaseLettersDigitsAndHyphens',
  usernameHyphen: 'usernameMustNotStartOrEndWithAHyphen',
  usernameReserved: 'usernameIsReserved',
  passwordTooShort: 'passwordMustBeAtLeastNCharacters',
  emailInvalid: 'emailMustBeAValidAddress',
  emailDomainReserved: 'emailDomainIsReserved'
} as const;

export type AccountPolicyErrorCode =
  (typeof ACCOUNT_POLICY_ERRORS)[keyof typeof ACCOUNT_POLICY_ERRORS];

// 与 ValidationResult 同形，但把失败原因收窄为已登记的账号策略错误码，让服务端
// 把它映射为 API 错误码时仍有编译期保证（ADR-0044、#145）。
export type AccountPolicyResult<T> =
  | { success: true; data: T }
  | { success: false; errors: AccountPolicyErrorCode[] };

// 密码最小长度的唯一权威：调用方（服务端与 Web）据此下发/展示生效值，
// 不再各自重算默认值。
export function resolvePasswordMinLength(minimumLength?: number): number {
  return minimumLength ?? DEFAULT_PASSWORD_MIN_LENGTH;
}

export function validatePassword(password: string, minimumLength?: number): AccountPolicyResult<string> {
  if (password.length < resolvePasswordMinLength(minimumLength)) {
    return { success: false, errors: [ACCOUNT_POLICY_ERRORS.passwordTooShort] };
  }
  return { success: true, data: password };
}

export function validateMemberUsername(username: string): AccountPolicyResult<string> {
  const errors: AccountPolicyErrorCode[] = [];
  if (username.length < ACCOUNT_NAME_MIN_LENGTH || username.length > ACCOUNT_NAME_MAX_LENGTH) {
    errors.push(ACCOUNT_POLICY_ERRORS.usernameLength);
  }
  if (!ACCOUNT_NAME_PATTERN.test(username)) {
    errors.push(ACCOUNT_POLICY_ERRORS.usernameAlphabet);
  }
  if (username.startsWith('-') || username.endsWith('-')) {
    errors.push(ACCOUNT_POLICY_ERRORS.usernameHyphen);
  }
  if (RESERVED_SCOPE_NAMES.has(username)) {
    errors.push(ACCOUNT_POLICY_ERRORS.usernameReserved);
  }
  return errors.length > 0 ? { success: false, errors } : { success: true, data: username };
}

export function normalizeSkillUserEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateSkillUserEmail(email: string): AccountPolicyResult<string> {
  const normalized = normalizeSkillUserEmail(email);
  const errors: AccountPolicyErrorCode[] = [];
  if (!SKILL_USER_EMAIL_PATTERN.test(normalized)) {
    errors.push(ACCOUNT_POLICY_ERRORS.emailInvalid);
  }
  if (normalized.endsWith(`@${SKILL_USER_EMAIL_RESERVED_DOMAIN}`)) {
    errors.push(ACCOUNT_POLICY_ERRORS.emailDomainReserved);
  }
  return errors.length > 0 ? { success: false, errors } : { success: true, data: normalized };
}

// Git Backend 用户账号的 email 约定(用户创建流程统一使用该格式):以该 email
// 作为 commit author 时,Git Backend 可通过 email 把提交匹配到对应账号。
export function giteaUserEmail(giteaUsername: string): string {
  return `${giteaUsername}@${SKILL_USER_EMAIL_RESERVED_DOMAIN}`;
}
