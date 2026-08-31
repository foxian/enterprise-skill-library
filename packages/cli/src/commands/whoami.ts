import { loadConfig, loadCredentials, type LocalStoreOptions } from '@esl/core';
import { resolveLoginTtlMs } from './network-options.js';

export interface WhoamiResult {
  loggedIn: boolean;
  username: string | null;
  org: string | null;
  server: string | null;
  loginAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

export async function executeWhoami(options: LocalStoreOptions = {}): Promise<WhoamiResult> {
  const config = await loadConfig({ homeDir: options.homeDir });
  const credentials = await loadCredentials({ homeDir: options.homeDir });

  const token = credentials.token;
  const loginAt = credentials.loginAt;
  const loginAtMs = loginAt ? Date.parse(loginAt) : NaN;
  const expired = !loginAt || Number.isNaN(loginAtMs) || Date.now() - loginAtMs > resolveLoginTtlMs();

  return {
    loggedIn: Boolean(token),
    username: config.username ?? null,
    org: config.org ?? null,
    server: config.server ?? null,
    loginAt,
    expiresAt: loginAt && !Number.isNaN(loginAtMs) ? new Date(loginAtMs + resolveLoginTtlMs()).toISOString() : null,
    expired
  };
}

export function formatWhoami(result: WhoamiResult): string {
  if (!result.loggedIn) {
    return 'Not logged in. Run esl login to authenticate.';
  }
  const lines: string[] = [];
  if (result.username) {
    lines.push(`Username: ${result.username}`);
  }
  if (result.org) {
    lines.push(`Organization: ${result.org}`);
  }
  if (result.server) {
    lines.push(`Server: ${result.server}`);
  }
  if (result.loginAt) {
    lines.push(`Logged in at: ${result.loginAt}`);
  }
  if (result.expiresAt) {
    lines.push(`Expires at: ${result.expiresAt}`);
  }
  lines.push(result.expired ? 'Status: expired (run esl login to re-authenticate)' : 'Status: active');
  return lines.join('\n');
}
