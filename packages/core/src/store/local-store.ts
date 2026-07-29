import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface LocalStorePaths {
  root: string;
  configJson: string;
  credentialsJson: string;
  cacheDir: string;
  skillsDir: string;
}

export interface EslConfig {
  registry: string | null;
  gitBase: string | null;
  token: string | null;
  username: string | null;
  tools: string[];
}

export interface LocalStoreOptions {
  homeDir?: string;
}

export function resolveLocalStorePaths(options: LocalStoreOptions = {}): LocalStorePaths {
  const homeDir = options.homeDir ?? os.homedir();
  const root = path.join(homeDir, '.skill-library');
  return {
    root,
    configJson: path.join(root, 'config.json'),
    credentialsJson: path.join(root, 'credentials.json'),
    cacheDir: path.join(root, 'cache'),
    skillsDir: path.join(root, 'skills')
  };
}

async function writeJsonIfMissing(filePath: string, value: unknown): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

export async function initializeLocalStore(options: LocalStoreOptions = {}): Promise<LocalStorePaths> {
  const paths = resolveLocalStorePaths(options);

  await fs.mkdir(paths.cacheDir, { recursive: true });
  await fs.mkdir(paths.skillsDir, { recursive: true });
  await writeJsonIfMissing(paths.configJson, {
    registry: null,
    gitBase: null,
    token: null,
    username: null,
    tools: []
  });
  await writeJsonIfMissing(paths.credentialsJson, {
    api_token: null
  });

  return paths;
}

export async function loadConfig(options: LocalStoreOptions = {}): Promise<EslConfig> {
  const paths = resolveLocalStorePaths(options);
  const raw = await fs.readFile(paths.configJson, 'utf8');
  return JSON.parse(raw) as EslConfig;
}

export async function saveConfig(
  config: Partial<EslConfig>,
  options: LocalStoreOptions = {}
): Promise<EslConfig> {
  const paths = resolveLocalStorePaths(options);
  const current = await loadConfig(options);
  const updated: EslConfig = { ...current, ...config };
  await fs.writeFile(paths.configJson, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return updated;
}
