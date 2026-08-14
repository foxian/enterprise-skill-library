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

export async function requireFreshToken(options: LocalStoreOptions = {}): Promise<string> {
  const credentials = await loadCredentials({ homeDir: options.homeDir });
  const token = requireConfigured(credentials.token, 'token');
  if (!credentials.loginAt) {
    throw new Error('Login expired; run esl login to re-authenticate');
  }
  const loginAt = Date.parse(credentials.loginAt);
  if (Number.isNaN(loginAt) || Date.now() - loginAt > resolveLoginTtlMs()) {
    throw new Error('Login expired; run esl login to re-authenticate');
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
