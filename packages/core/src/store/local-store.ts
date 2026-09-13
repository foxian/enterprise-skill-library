import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface LocalStorePaths {
  root: string;
  configJson: string;
  credentialsJson: string;
  cacheDir: string;
  skillsDir: string;
}

// 组织隶属关系（ADR-0032）：登录时由服务端按 Gitea 成员关系派生并随
// 登录响应下发，CLI 侧只做展示（whoami/status）。
export interface OrganizationMembership {
  org: string;
  role: 'org-admin' | 'member';
}

export interface EslCredentials {
  token: string | null;
  loginAt: string | null;
}

export interface LocalStoreOptions {
  homeDir?: string;
}

export function resolveLocalStorePaths(options: LocalStoreOptions = {}): LocalStorePaths {
  const homeDir = options.homeDir ?? os.homedir();
  const root = path.join(homeDir, '.skill-library');
  return {
    root,
    configJson: path.join(root, 'config.json'),
    credentialsJson: path.join(root, 'credentials.json'),
    cacheDir: path.join(root, 'cache'),
    skillsDir: path.join(root, 'skills')
  };
}

async function writeJsonIfMissing(filePath: string, value: unknown): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

export async function initializeLocalStore(options: LocalStoreOptions = {}): Promise<LocalStorePaths> {
  const paths = resolveLocalStorePaths(options);

  await fs.mkdir(paths.cacheDir, { recursive: true });
  await fs.mkdir(paths.skillsDir, { recursive: true });
  await writeJsonIfMissing(paths.configJson, {
    server: null,
    username: null,
    organizations: null,
    tools: []
  });
  await writeJsonIfMissing(paths.credentialsJson, {
    token: null,
    loginAt: null
  });

  return paths;
}

// 旧版（<org>_<username> 时代）配置标记：config.json 含 org/role 键时为 true，
// 调用方据此提示重新登录。
export interface ConfigIdentity {
  legacyIdentity?: boolean;
}

export interface EslConfig extends ConfigIdentity {
  server: string | null;
  username: string | null;
  organizations: OrganizationMembership[] | null;
  tools: string[];
}

export async function loadConfig(options: LocalStoreOptions = {}): Promise<EslConfig> {
  const paths = resolveLocalStorePaths(options);
  const raw = await fs.readFile(paths.configJson, 'utf8');
  const parsed = JSON.parse(raw) as EslConfig & { org?: unknown; role?: unknown };
  // 旧版配置带 org/role（ADR-0032 已废除）：读取侧剥离并打标记。
  const legacyIdentity = 'org' in parsed || 'role' in parsed;
  const { org: _legacyOrg, role: _legacyRole, ...rest } = parsed;
  if (rest.organizations === undefined) {
    rest.organizations = null;
  }
  return legacyIdentity ? { ...rest, legacyIdentity: true } : rest;
}

export async function saveConfig(
  config: Partial<EslConfig>,
  options: LocalStoreOptions = {}
): Promise<EslConfig> {
  const paths = resolveLocalStorePaths(options);
  const current = await loadConfig(options);
  const updated: EslConfig = { ...current, ...config };
  await fs.writeFile(paths.configJson, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return updated;
}

export async function loadCredentials(options: LocalStoreOptions = {}): Promise<EslCredentials> {
  const paths = resolveLocalStorePaths(options);
  const raw = await fs.readFile(paths.credentialsJson, 'utf8');
  return JSON.parse(raw) as EslCredentials;
}

export async function saveCredentials(
  credentials: Partial<EslCredentials>,
  options: LocalStoreOptions = {}
): Promise<EslCredentials> {
  const paths = resolveLocalStorePaths(options);
  const current = await loadCredentials(options);
  const updated: EslCredentials = { ...current, ...credentials };
  await fs.writeFile(paths.credentialsJson, `${JSON.stringify(updated, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  return updated;
}

export async function clearCredentials(options: LocalStoreOptions = {}): Promise<EslCredentials> {
  const paths = resolveLocalStorePaths(options);
  await fs.mkdir(paths.root, { recursive: true });
  const cleared: EslCredentials = { token: null, loginAt: null };
  await fs.writeFile(paths.credentialsJson, `${JSON.stringify(cleared, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  return cleared;
}
