import {
  parseSkillName,
  loadConfig,
  loadCredentials,
  resolveLocalStorePaths,
  type LocalStoreOptions
} from '@esl/core';
import path from 'node:path';

export interface NetworkCommandOptions extends LocalStoreOptions {
  registry?: string;
  gitBase?: string;
  customFetch?: typeof fetch;
}

export interface ResolvedNetworkConfig {
  registry: string;
  gitBase: string | null;
  token: string | null;
}

export async function resolveNetworkConfig(options: NetworkCommandOptions): Promise<ResolvedNetworkConfig> {
  const config = await loadConfig({ homeDir: options.homeDir });
  const credentials = await loadCredentials({ homeDir: options.homeDir });
  return {
    registry: options.registry ?? requireConfigured(config.registry, 'registry'),
    gitBase: options.gitBase ?? config.gitBase,
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

export function apiUrl(registry: string, path: string): string {
  const base = registry.replace(/\/$/, '');
  if (base.endsWith('/api') && path.startsWith('/api/')) {
    return `${base}${path.slice('/api'.length)}`;
  }
  return `${base}${path}`;
}

export function authenticatedGitUrl(gitBase: string, token: string, repoPath: string): string {
  const base = gitBase.replace(/\/$/, '');
  const url = new URL(`${base}/${repoPath}.git`);
  url.username = token;
  return url.toString();
}

export function remoteGitUrl(gitBase: string, repoPath: string): string {
  const base = gitBase.replace(/\/$/, '');
  return `${base}/${repoPath}.git`;
}

export function installTargetDir(skillName: string, options: LocalStoreOptions): string {
  const { scope, skillName: shortName } = parseSkillName(skillName);
  return path.join(resolveLocalStorePaths(options).skillsDir, `@${scope}`, shortName);
}

export function projectSkillsDir(projectRoot: string, skillName: string): string {
  const { scope, skillName: shortName } = parseSkillName(skillName);
  return path.join(projectRoot, '.skills', `@${scope}`, shortName);
}
