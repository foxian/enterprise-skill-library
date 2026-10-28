import { loadConfig, saveConfig, type LocalStoreOptions } from '@esl/core';

export const DEFAULT_ESL_SERVER = 'https://cloud.enterprise-skills.com/';

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
  const fromEnv = process.env.ESL_SERVER;
  if (fromEnv) {
    return fromEnv;
  }
  const config = await loadConfig({ homeDir: options.homeDir });
  return config.server ?? DEFAULT_ESL_SERVER;
}

export async function setCliUpdateCheck(enabled: boolean, options: LocalStoreOptions = {}): Promise<void> {
  const config = await loadConfig({ homeDir: options.homeDir });
  await saveConfig({ cliUpdate: { ...config.cliUpdate, enabled } }, { homeDir: options.homeDir });
}
