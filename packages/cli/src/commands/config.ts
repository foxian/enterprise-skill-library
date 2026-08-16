import { loadConfig, saveConfig, type LocalStoreOptions } from '@esl/core';

export interface ConfigCommandOptions extends LocalStoreOptions {
  server?: string;
}

export async function executeSetServer(url: string, options: LocalStoreOptions = {}): Promise<{ server: string }> {
  const config = await saveConfig({ server: url }, { homeDir: options.homeDir });
  return { server: config.server! };
}

export async function resolveServer(options: ConfigCommandOptions = {}): Promise<string> {
  if (options.server) {
    return options.server;
  }
  const config = await loadConfig({ homeDir: options.homeDir });
  if (!config.server) {
    throw new Error('Missing server; run esl config set-server <url> or pass --server');
  }
  return config.server;
}
