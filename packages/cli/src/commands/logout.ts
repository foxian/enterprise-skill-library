import { clearCredentials, loadCredentials, type LocalStoreOptions } from '@esl/core';

export interface LogoutResult {
  hadCredentials: boolean;
}

export async function executeLogout(options: LocalStoreOptions = {}): Promise<LogoutResult> {
  let hadCredentials = false;
  try {
    const credentials = await loadCredentials({ homeDir: options.homeDir });
    hadCredentials = Boolean(credentials.token);
  } catch {
    hadCredentials = false;
  }
  await clearCredentials({ homeDir: options.homeDir });
  return { hadCredentials };
}

export function formatLogout(result: LogoutResult): string {
  return result.hadCredentials
    ? 'Logged out. Local credentials cleared.'
    : 'Not logged in; no credentials to clear.';
}
