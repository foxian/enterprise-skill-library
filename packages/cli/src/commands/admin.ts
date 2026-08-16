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

export interface CreateUserResult extends AdminUserResult {
  password?: string;
}

export interface PasswordSupplyOptions extends NetworkCommandOptions {
  passwordFile?: string;
  random?: boolean;
}

export interface ChangePasswordOptions extends NetworkCommandOptions {
  passwordFile?: string;
  noInput?: boolean;
  readInput?: () => Promise<string>;
  readPassword?: (prompt: string) => Promise<string>;
}

export interface ChangeOwnPasswordOptions extends ChangePasswordOptions {
  currentPasswordFile?: string;
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
  options: PasswordSupplyOptions = {}
): Promise<CreateUserResult> {
  const fetchImpl = options.customFetch ?? fetch;
  const { server, token } = await resolveAdminAuth(options);
  const password = await resolveOptionalPassword(options);
  const res = await fetchWithTimeout(fetchImpl, apiUrl(server, '/api/admin/users'), {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(password ? { username, password } : { username })
  });
  if (!res.ok) {
    const err = await readErrorMessage(res);
    throw new Error(`Failed to create user: ${err}`);
  }
  return (await res.json()) as CreateUserResult;
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

export interface SetUserPasswordResult {
  username: string;
  password?: string;
}

export async function executeSetUserPassword(
  username: string,
  options: PasswordSupplyOptions = {}
): Promise<SetUserPasswordResult> {
  const fetchImpl = options.customFetch ?? fetch;
  const { server, token } = await resolveAdminAuth(options);
  const password = await resolveOptionalPassword(options);
  const res = await fetchWithTimeout(fetchImpl, apiUrl(server, `/api/admin/users/${encodeURIComponent(username)}/password`), {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(password ? { password } : {})
  });
  if (!res.ok) {
    const err = await readErrorMessage(res);
    throw new Error(`Failed to set user password: ${err}`);
  }
  return (await res.json()) as SetUserPasswordResult;
}

export async function executeAdministratorAccountPasswordChange(options: ChangePasswordOptions): Promise<void> {
  const fetchImpl = options.customFetch ?? fetch;
  const { server, token } = await resolveAdminAuth(options);
  const password = await resolveNewPassword(options);
  const res = await fetchWithTimeout(fetchImpl, apiUrl(server, '/api/admin/account/password'), {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ password })
  });
  if (!res.ok) {
    const err = await readErrorMessage(res);
    throw new Error(`Failed to change administrator account password: ${err}`);
  }
}

export async function executeChangeOwnPassword(options: ChangeOwnPasswordOptions): Promise<void> {
  const fetchImpl = options.customFetch ?? fetch;
  const { server, token } = await resolveAdminAuth(options);
  const currentPassword = await resolveCurrentPassword(options);
  const newPassword = await resolveNewPassword(options);
  const res = await fetchWithTimeout(fetchImpl, apiUrl(server, '/api/auth/password'), {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ oldPassword: currentPassword, newPassword })
  });
  if (!res.ok) {
    const err = await readErrorMessage(res);
    throw new Error(`Failed to change password: ${err}`);
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body.error === 'string') {
      return body.error;
    }
  } catch {
    // Fall through to the raw response body.
  }
  return text;
}

async function resolveOptionalPassword(options: PasswordSupplyOptions): Promise<string | undefined> {
  if (options.passwordFile && options.random) {
    throw new Error('--password-file and --random are mutually exclusive');
  }
  if (options.passwordFile) {
    const password = (await fs.readFile(options.passwordFile, 'utf8')).trim();
    if (!password) {
      throw new Error(`Password file ${options.passwordFile} is empty`);
    }
    return password;
  }
  return undefined;
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
    if (options.readInput) {
      return readPasswordFromInput(options.readInput);
    }
    throw new Error('A new password is required; pass --password-file or pipe a password on stdin when using --no-input');
  }
  if (options.readInput) {
    return readPasswordFromInput(options.readInput);
  }
  if (options.readPassword) {
    return readConfirmedPassword(options.readPassword);
  }
  if (!isInteractive()) {
    throw new Error('A new password is required; run interactively, pass --password-file, or pipe a password on stdin');
  }
  return readConfirmedPassword((prompt: string) => readHidden(prompt));
}

async function readPasswordFromInput(readInput: () => Promise<string>): Promise<string> {
  const password = (await readInput()).trim();
  if (!password) {
    throw new Error('Password is required');
  }
  return password;
}

async function resolveCurrentPassword(options: ChangeOwnPasswordOptions): Promise<string> {
  if (options.currentPasswordFile) {
    const password = (await fs.readFile(options.currentPasswordFile, 'utf8')).trim();
    if (!password) {
      throw new Error(`Password file ${options.currentPasswordFile} is empty`);
    }
    return password;
  }

  if (options.noInput) {
    if (options.readInput) {
      return readPasswordFromInput(options.readInput);
    }
    throw new Error('A current password is required; pass --current-password-file or pipe a password on stdin when using --no-input');
  }
  if (options.readInput) {
    return readPasswordFromInput(options.readInput);
  }
  if (options.readPassword) {
    return (await options.readPassword('Current password: ')).trim();
  }
  if (!isInteractive()) {
    throw new Error('A current password is required; run interactively or pass --current-password-file');
  }
  return (await readHidden('Current password: ')).trim();
}

async function readConfirmedPassword(readPassword: (prompt: string) => Promise<string>): Promise<string> {
  const password = (await readPassword('New password: ')).trim();
  if (!password) {
    throw new Error('Password is required');
  }
  const confirmPassword = (await readPassword('Confirm new password: ')).trim();
  if (password !== confirmPassword) {
    throw new Error('Passwords do not match');
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
