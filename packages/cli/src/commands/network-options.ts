import { parseSkillName, loadConfig, resolveLocalStorePaths, type LocalStoreOptions } from '@esl/core';
import path from 'node:path';

export interface NetworkCommandOptions extends LocalStoreOptions {
  registry?: string;
  gitBase?: string;
  token?: string;
  customFetch?: typeof fetch;
}

export interface ResolvedNetworkConfig {
  registry: string;
  gitBase: string | null;
  token: string | null;
}

export async function resolveNetworkConfig(options: NetworkCommandOptions): Promise<ResolvedNetworkConfig> {
  if (options.registry && options.gitBase && options.token) {
    return { registry: options.registry, gitBase: options.gitBase, token: options.token };
  }

  const config = await loadConfig({ homeDir: options.homeDir });
  return {
    registry: options.registry ?? requireConfigured(config.registry, 'registry'),
    gitBase: options.gitBase ?? config.gitBase,
    token: options.token ?? config.token
  };
}

export function requireConfigured(value: string | null | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing ${name}; run esl login or pass --${name}`);
  }
  return value;
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

export function installTargetDir(skillName: string, options: LocalStoreOptions): string {
  const { scope, skillName: shortName } = parseSkillName(skillName);
  return path.join(resolveLocalStorePaths(options).skillsDir, `@${scope}`, shortName);
}

export function projectSkillsDir(projectRoot: string, skillName: string): string {
  const { scope, skillName: shortName } = parseSkillName(skillName);
  return path.join(projectRoot, '.skills', `@${scope}`, shortName);
}
