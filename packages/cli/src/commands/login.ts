import { initializeLocalStore, saveConfig, saveCredentials, type LocalStoreOptions } from '@esl/core';
import fs from 'node:fs/promises';
import { isInteractive, readHidden } from '../prompt.js';
import { fetchWithTimeout } from './network-options.js';

export interface LoginOptions extends LocalStoreOptions {
  server: string;
  username: string;
  passwordFile?: string;
  tokenFile?: string;
  noInput?: boolean;
  readInput?: () => Promise<string>;
  customFetch?: typeof fetch;
}

export async function executeLogin(options: LoginOptions): Promise<string> {
  const fetchImpl = options.customFetch ?? fetch;
  await initializeLocalStore({ homeDir: options.homeDir });

  const token = await resolveLoginToken(options, fetchImpl);

  await saveCredentials({ token, loginAt: new Date().toISOString() }, { homeDir: options.homeDir });
  await saveConfig(
    {
      server: options.server,
      username: options.username
    },
    { homeDir: options.homeDir }
  );

  return token;
}

async function resolveLoginToken(options: LoginOptions, fetchImpl: typeof fetch): Promise<string> {
  if (options.tokenFile) {
    const token = (await fs.readFile(options.tokenFile, 'utf8')).trim();
    if (!token) {
      throw new Error(`Token file ${options.tokenFile} is empty`);
    }
    return token;
  }

  const password = options.passwordFile
    ? (await fs.readFile(options.passwordFile, 'utf8')).trim()
    : await promptForPassword(options);

  if (!password) {
    throw new Error('Password is required for login');
  }

  return exchangePasswordForToken(options, password, fetchImpl);
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
  options: LoginOptions,
  password: string,
  fetchImpl: typeof fetch
): Promise<string> {
  const server = options.server.replace(/\/$/, '');
  const res = await fetchWithTimeout(fetchImpl, `${server}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username: options.username, password })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to authenticate with ESL Server: ${err}`);
  }

  const data = (await res.json()) as { token: string };
  return data.token;
}
