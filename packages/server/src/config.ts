import { DEFAULT_PASSWORD_MIN_LENGTH } from '@esl/core';

export interface ServerConfig {
  port: number;
  databasePath: string;
  giteaUrl: string;
  giteaAdminToken?: string;
  giteaAdminTokenFile?: string;
  giteaAdminUsername: string;
  giteaAdminPassword?: string;
  repoOwner: string;
  passwordMinLength: number;
  applicationEncryptionKey?: string;
  // When true the server seeds sample skill metadata at startup (ESL_AUTO_SEED).
  // Development environments opt in; production keeps the database clean.
  autoSeed: boolean;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const portRaw = env.PORT ?? '3000';
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${portRaw}`);
  }

  const giteaAdminToken = env.GITEA_ADMIN_TOKEN;
  const giteaAdminTokenFile = env.GITEA_ADMIN_TOKEN_FILE ?? '/bootstrap/gitea-admin-token';
  if (!giteaAdminToken && !giteaAdminTokenFile) {
    throw new Error('Missing required environment variable: GITEA_ADMIN_TOKEN or GITEA_ADMIN_TOKEN_FILE');
  }
  const passwordMinLength = Number.parseInt(env.ESL_PASSWORD_MIN_LENGTH ?? String(DEFAULT_PASSWORD_MIN_LENGTH), 10);
  if (!Number.isInteger(passwordMinLength) || passwordMinLength < 1) {
    throw new Error(`Invalid ESL_PASSWORD_MIN_LENGTH: ${env.ESL_PASSWORD_MIN_LENGTH}`);
  }
  const autoSeed = env.ESL_AUTO_SEED === 'true' || env.ESL_AUTO_SEED === '1';

  return {
    port,
    databasePath: requireEnv(env, 'DATABASE_PATH'),
    giteaUrl: requireEnv(env, 'GITEA_URL'),
    giteaAdminToken,
    giteaAdminTokenFile,
    giteaAdminUsername: env.GITEA_ADMIN_USERNAME ?? 'eslroot',
    giteaAdminPassword: env.GITEA_ADMIN_PASSWORD,
    // Transitional fixed namespace for Server-hosted Skill Sources; per-org
    // scopes arrive with the multi-tenant upload flow (docs/adr/0016).
    repoOwner: 'esl-skills',
    passwordMinLength,
    autoSeed,
    ...(env.ESL_APPLICATION_ENCRYPTION_KEY
      ? { applicationEncryptionKey: env.ESL_APPLICATION_ENCRYPTION_KEY }
      : {})
  };
}
