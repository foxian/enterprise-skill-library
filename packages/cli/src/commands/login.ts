import { initializeLocalStore, saveConfig, type LocalStoreOptions } from '@esl/core';

export interface LoginOptions extends LocalStoreOptions {
  registry: string;
  gitBase: string;
  username: string;
  password?: string;
  token?: string;
  customFetch?: typeof fetch;
}

export async function executeLogin(options: LoginOptions): Promise<string> {
  const fetchImpl = options.customFetch ?? fetch;
  await initializeLocalStore({ homeDir: options.homeDir });

  let token = options.token;
  if (!token && options.password) {
    const authHeader = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`;
    const giteaApiUrl = options.gitBase.replace(/\/git\/?$/, '');
    const res = await fetchImpl(`${giteaApiUrl}/api/v1/users/${options.username}/tokens`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: `esl-cli-${Date.now()}` })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to authenticate with Gitea: ${err}`);
    }

    const data = (await res.json()) as { sha1: string };
    token = data.sha1;
  }

  if (!token) {
    throw new Error('Password or Token is required for login');
  }

  await saveConfig(
    {
      registry: options.registry,
      gitBase: options.gitBase,
      username: options.username,
      token
    },
    { homeDir: options.homeDir }
  );

  return token;
}
