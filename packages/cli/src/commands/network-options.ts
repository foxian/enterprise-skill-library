import {
  parseSkillName,
  loadConfig,
  loadCredentials,
  resolveLocalStorePaths,
  type LocalStoreOptions
} from '@esl/core';
import path from 'node:path';

export interface NetworkCommandOptions extends LocalStoreOptions {
  server?: string;
  customFetch?: typeof fetch;
  builtinDir?: string;
}

export interface ResolvedNetworkConfig {
  server: string;
  token: string | null;
}

export async function resolveNetworkConfig(options: NetworkCommandOptions): Promise<ResolvedNetworkConfig> {
  const config = await loadConfig({ homeDir: options.homeDir });
  const credentials = await loadCredentials({ homeDir: options.homeDir });
  return {
    server: options.server ?? requireConfigured(config.server, 'server'),
    token: credentials.token
  };
}

export function requireConfigured(value: string | null | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing ${name}; run esl login or pass --${name}`);
  }
  return value;
}

// ADR-0021 后续：403 通常意味着技能由其他账号/组织维护（各组织账号相互独立）。
// 在原始错误后附加可行动指引，替代裸 403 信息。
function withAuthGuidance(message: string): string {
  return `${message}\nThis skill may be maintained by another account or organization; log in with the maintaining organization ("esl login") and retry.`;
}

// 403 时附加跨账号指引，其余状态码原样返回。
export function withAuthGuidanceIfForbidden(status: number, message: string): string {
  return status === 403 ? withAuthGuidance(message) : message;
}

export function resolveTimeoutMs(): number {
  const env = process.env.ESL_HTTP_TIMEOUT;
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 30_000;
}

export function resolveLoginTtlMs(): number {
  const env = process.env.ESL_LOGIN_TTL_HOURS;
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed * 3_600_000;
    }
  }
  return 720 * 3_600_000;
}

// 登录是否仍在 TTL 有效期内（本地时间戳判断，不向服务器验证）。
export function isLoginFresh(loginAt: string | null | undefined): boolean {  if (!loginAt) {
    return false;
  }
  const loginAtMs = Date.parse(loginAt);
  return !Number.isNaN(loginAtMs) && Date.now() - loginAtMs <= resolveLoginTtlMs();
}

export async function requireFreshToken(options: LocalStoreOptions = {}): Promise<string> {
  const credentials = await loadCredentials({ homeDir: options.homeDir });
  const token = requireConfigured(credentials.token, 'token');
  if (!isLoginFresh(credentials.loginAt)) {
    throw new Error('Login expired; run esl login to re-authenticate');
  }
  return token;
}

// 匿名也可用的请求所用尽力而为的凭据：登录仍在有效期则返回 token，
// 缺失或过期返回 null（调用方按匿名处理）。
export async function resolveOptionalFreshToken(options: LocalStoreOptions = {}): Promise<string | null> {
  let token: string | null;
  let loginAt: string | null;
  try {
    const credentials = await loadCredentials({ homeDir: options.homeDir });
    token = credentials.token;
    loginAt = credentials.loginAt;
  } catch {
    return null;
  }
  if (!token || !isLoginFresh(loginAt)) {
    return null;
  }
  return token;
}

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = resolveTimeoutMs()
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && (error as Error)?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function apiUrl(server: string, path: string): string {
  const base = server.replace(/\/$/, '');
  return `${base}${path}`;
}

export function gitAuthHeaderConfig(token: string): string {
  return `http.extraHeader=Authorization: Bearer ${token}`;
}

export function installTargetDir(skillName: string, options: LocalStoreOptions): string {
  const { scope, skillName: shortName } = parseSkillName(skillName);
  return path.join(resolveLocalStorePaths(options).skillsDir, `@${scope}`, shortName);
}

export function projectSkillsDir(projectRoot: string, skillName: string): string {
  const { scope, skillName: shortName } = parseSkillName(skillName);
  return path.join(projectRoot, '.skills', `@${scope}`, shortName);
}

export function publishedInstallTargetDir(
  skillName: string,
  options: LocalStoreOptions
): string {
  const { scope, skillName: shortName } = parseSkillName(skillName);
  return path.join(resolveLocalStorePaths(options).skillsDir, `${scope}_${shortName}`);
}

export function publishedProjectSkillsDir(projectRoot: string, skillName: string): string {
  const { scope, skillName: shortName } = parseSkillName(skillName);
  return path.join(projectRoot, '.skills', `${scope}_${shortName}`);
}
