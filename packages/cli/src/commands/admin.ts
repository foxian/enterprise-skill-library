import fs from 'node:fs/promises';
import { isInteractive, readHidden } from '../prompt.js';
import { apiUrl, fetchWithTimeout, requireConfigured, requireFreshToken, resolveNetworkConfig, type NetworkCommandOptions } from './network-options.js';

export interface BootstrapStatus {
  ready: boolean;
  gitea?: 'ready' | 'missing';
  adminToken?: 'ready' | 'missing' | 'invalid';
  repoOwner?: 'ready' | 'missing';
}

export interface AdminUserResult {
  username: string;
  disabled: boolean;
}

export interface ChangePasswordOptions extends NetworkCommandOptions {
  passwordFile?: string;
  noInput?: boolean;
  readInput?: () => Promise<string>;
}

export async function executeBootstrapStatus(options: NetworkCommandOptions = {}): Promise<BootstrapStatus> {
  const fetchImpl = options.customFetch ?? fetch;
  const server = (await resolveNetworkConfig(options)).server;
  const res = await fetchWithTimeout(fetchImpl, apiUrl(server, '/api/admin/bootstrap/status'));
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to check bootstrap status: ${err}`);
  }
  return (await res.json()) as BootstrapStatus;
}

export async function executeCreateUser(
  username: string,
  options: NetworkCommandOptions = {}
): Promise<AdminUserResult> {
  const fetchImpl = options.customFetch ?? fetch;
  const { server, token } = await resolveAdminAuth(options);
  const res = await fetchWithTimeout(fetchImpl, apiUrl(server, '/api/admin/users'), {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create user: ${err}`);
  }
  return (await res.json()) as AdminUserResult;
}

export async function executeIssueUserToken(
  username: string,
  options: NetworkCommandOptions = {}
): Promise<string> {
  const fetchImpl = options.customFetch ?? fetch;
  const { server, token } = await resolveAdminAuth(options);
  const res = await fetchWithTimeout(fetchImpl, apiUrl(server, `/api/admin/users/${encodeURIComponent(username)}/tokens`), {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to issue user token: ${err}`);
  }
  const body = (await res.json()) as { token: string };
  return body.token;
}

export async function executeDisableUser(username: string, options: NetworkCommandOptions = {}): Promise<void> {
  const fetchImpl = options.customFetch ?? fetch;
  const { server, token } = await resolveAdminAuth(options);
  const res = await fetchWithTimeout(fetchImpl, apiUrl(server, `/api/admin/users/${encodeURIComponent(username)}/disable`), {
    method: 'POST',
    headers: { Authorization: `token ${token}` }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to disable user: ${err}`);
  }
}

export async function executeGiteaPasswordChange(options: ChangePasswordOptions): Promise<void> {
  const fetchImpl = options.customFetch ?? fetch;
  const { server, token } = await resolveAdminAuth(options);
  const password = await resolveNewPassword(options);
  const res = await fetchWithTimeout(fetchImpl, apiUrl(server, '/api/admin/gitea/password'), {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ password })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to change Gitea password: ${err}`);
  }
}

async function resolveNewPassword(options: ChangePasswordOptions): Promise<string> {
  if (options.passwordFile) {
    const password = (await fs.readFile(options.passwordFile, 'utf8')).trim();
    if (!password) {
      throw new Error(`Password file ${options.passwordFile} is empty`);
    }
    return password;
  }

  if (options.noInput) {
    throw new Error('A new password is required; pass --password-file when using --no-input');
  }
  if (options.readInput) {
    const password = (await options.readInput()).trim();
    if (!password) {
      throw new Error('Password is required');
    }
    return password;
  }
  if (!isInteractive()) {
    throw new Error('A new password is required; run interactively or pass --password-file');
  }
  const password = (await readHidden('New password: ')).trim();
  if (!password) {
    throw new Error('Password is required');
  }
  return password;
}

async function resolveAdminAuth(options: NetworkCommandOptions): Promise<{ server: string; token: string }> {
  const config = await resolveNetworkConfig(options);
  return {
    server: config.server,
    token: requireConfigured(await requireFreshToken(options), 'token')
  };
}
