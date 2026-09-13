import {
  initializeLocalStore,
  saveConfig,
  saveCredentials,
  type LocalStoreOptions,
  type OrganizationMembership
} from '@esl/core';
import fs from 'node:fs/promises';
import { isInteractive, readHidden, readText } from '../prompt.js';
import { resolveServer } from './config.js';
import { fetchWithTimeout } from './network-options.js';

export interface LoginOptions extends LocalStoreOptions {
  server?: string;
  username?: string;
  passwordFile?: string;
  tokenFile?: string;
  noInput?: boolean;
  readInput?: () => Promise<string>;
  readServer?: () => Promise<string>;
  readUsername?: (prompt: string) => Promise<string>;
  customFetch?: typeof fetch;
}

export interface LoginResult {
  token: string;
  username: string;
  organizations: OrganizationMembership[];
}

// 全局身份登录（ADR-0032）：username + password 一条凭据，无组织输入；
// 所属组织列表由服务端按 Gitea 成员关系派生。
export async function executeLogin(options: LoginOptions): Promise<LoginResult> {
  const fetchImpl = options.customFetch ?? fetch;
  await initializeLocalStore({ homeDir: options.homeDir });

  const server = await resolveServerForLogin(options);
  const username = await resolveUsername(options);
  const { token, organizations } = await resolveLoginToken(options, server, username, fetchImpl);

  await saveCredentials({ token, loginAt: new Date().toISOString() }, { homeDir: options.homeDir });
  await saveConfig({ server, username, organizations }, { homeDir: options.homeDir });

  return { token, username, organizations };
}

// 首次使用未配置 server 时交互式询问并记住;非交互环境直接报错。
async function resolveServerForLogin(options: LoginOptions): Promise<string> {
  try {
    return await resolveServer({ server: options.server, homeDir: options.homeDir });
  } catch (error) {
    if (options.noInput) {
      throw error;
    }
    if (options.readServer) {
      const url = (await options.readServer()).trim();
      if (!url) {
        throw error;
      }
      return url;
    }
    if (!isInteractive()) {
      throw error;
    }
    const url = (await readText('Server URL (e.g. http://localhost:3000): ')).trim();
    if (!url) {
      throw error;
    }
    return url;
  }
}

async function resolveUsername(options: LoginOptions): Promise<string> {
  if (options.username) {
    return options.username;
  }
  if (options.noInput) {
    throw new Error('A username is required; pass --username or run interactively');
  }
  if (options.readUsername) {
    return (await options.readUsername('Username: ')).trim();
  }
  if (!isInteractive()) {
    throw new Error('A username is required; pass --username or run interactively');
  }
  return (await readText('Username: ')).trim();
}

async function resolveLoginToken(
  options: LoginOptions,
  server: string,
  username: string,
  fetchImpl: typeof fetch
): Promise<{ token: string; organizations: OrganizationMembership[] }> {
  if (options.tokenFile) {
    const token = (await fs.readFile(options.tokenFile, 'utf8')).trim();
    if (!token) {
      throw new Error(`Token file ${options.tokenFile} is empty`);
    }
    // token-file 登录不联网,拿不到成员关系;组织列表留空,whoami/status
    // 以本地已有信息展示。
    return { token, organizations: [] };
  }

  const password = options.passwordFile
    ? (await fs.readFile(options.passwordFile, 'utf8')).trim()
    : await promptForPassword(options);

  if (!password) {
    throw new Error('Password is required for login');
  }

  return exchangePasswordForToken(server, username, password, fetchImpl);
}

async function promptForPassword(options: LoginOptions): Promise<string> {
  if (options.noInput) {
    throw new Error('Login requires a password or token; pass --password-file or --token-file when using --no-input');
  }
  if (options.readInput) {
    return (await options.readInput()).trim();
  }
  if (!isInteractive()) {
    throw new Error('Login requires a password; run interactively or pass --password-file/--token-file');
  }
  return (await readHidden('Password: ')).trim();
}

async function exchangePasswordForToken(
  server: string,
  username: string,
  password: string,
  fetchImpl: typeof fetch
): Promise<{ token: string; organizations: OrganizationMembership[] }> {
  const base = server.replace(/\/$/, '');
  const res = await fetchWithTimeout(fetchImpl, `${base}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to authenticate with ESL Server: ${err}`);
  }

  const data = (await res.json()) as { token: string; organizations?: OrganizationMembership[] };
  return { token: data.token, organizations: Array.isArray(data.organizations) ? data.organizations : [] };
}
