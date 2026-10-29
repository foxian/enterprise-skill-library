import { loadConfig, saveConfig, type LocalStoreOptions } from '@esl/core';

export const DEFAULT_ESL_SERVER = 'https://cloud.enterprise-skills.com/';

export interface ConfigCommandOptions extends LocalStoreOptions {
  server?: string;
}

function validateServerUrl(value: string): void {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    throw new Error('Server URL must include http:// or https://, e.g. https://esl.example.com or http://localhost:4070.');
  }

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('invalid HTTP(S) URL');
  } catch {
    throw new Error('Server URL must be a valid HTTP(S) URL, e.g. https://esl.example.com or http://localhost:4070.');
  }
}

export async function executeSetServer(url: string, options: LocalStoreOptions = {}): Promise<{ server: string }> {
  validateServerUrl(url);
  const config = await saveConfig({ server: url }, { homeDir: options.homeDir });
  return { server: config.server! };
}

export async function resolveServer(options: ConfigCommandOptions = {}): Promise<string> {
  if (options.server) {
    return options.server;
  }
  const fromEnv = process.env.ESL_SERVER;
  if (fromEnv) {
    return fromEnv;
  }
  const config = await loadConfig({ homeDir: options.homeDir });
  return config.server ?? DEFAULT_ESL_SERVER;
}
