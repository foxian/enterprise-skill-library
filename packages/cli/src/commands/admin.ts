import { loadConfig, type LocalStoreOptions } from '@esl/core';
import { apiUrl, requireConfigured, type NetworkCommandOptions } from './network-options.js';

export interface BootstrapStatus {
  ready: boolean;
  registry?: string;
  admin?: string;
}

export interface AdminUserResult {
  username: string;
  disabled: boolean;
}

export interface ChangePasswordOptions extends NetworkCommandOptions {
  password: string;
}

export async function executeBootstrapStatus(options: NetworkCommandOptions = {}): Promise<BootstrapStatus> {
  const fetchImpl = options.customFetch ?? fetch;
  const registry = await resolveAdminRegistry(options);
  const res = await fetchImpl(apiUrl(registry, '/api/admin/bootstrap/status'));
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
  const { registry, token } = await resolveAdminAuth(options);
  const res = await fetchImpl(apiUrl(registry, '/api/admin/users'), {
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
  const { registry, token } = await resolveAdminAuth(options);
  const res = await fetchImpl(apiUrl(registry, `/api/admin/users/${encodeURIComponent(username)}/tokens`), {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json'
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
  const { registry, token } = await resolveAdminAuth(options);
  const res = await fetchImpl(apiUrl(registry, `/api/admin/users/${encodeURIComponent(username)}/disable`), {
    method: 'POST',
    headers: { Authorization: `token ${token}` }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to disable user: ${err}`);
  }
}

export async function executeChangePassword(options: ChangePasswordOptions): Promise<void> {
  const fetchImpl = options.customFetch ?? fetch;
  const { registry, token } = await resolveAdminAuth(options);
  const res = await fetchImpl(apiUrl(registry, '/api/admin/password'), {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ password: options.password })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to change password: ${err}`);
  }
}

async function resolveAdminRegistry(options: NetworkCommandOptions & LocalStoreOptions): Promise<string> {
  if (options.registry) return options.registry;
  const config = await loadConfig({ homeDir: options.homeDir });
  return requireConfigured(config.registry, 'registry');
}

async function resolveAdminAuth(
  options: NetworkCommandOptions & LocalStoreOptions
): Promise<{ registry: string; token: string; username: string }> {
  const config = await loadConfig({ homeDir: options.homeDir });
  return {
    registry: options.registry ?? requireConfigured(config.registry, 'registry'),
    token: requireConfigured(options.token ?? config.token, 'token'),
    username: requireConfigured(config.username, 'username')
  };
}
