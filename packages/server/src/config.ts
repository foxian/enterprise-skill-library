export interface ServerConfig {
  port: number;
  databasePath: string;
  giteaUrl: string;
  giteaAdminToken?: string;
  giteaAdminTokenFile?: string;
  giteaAdminUsername: string;
  giteaAdminPassword?: string;
  repoOwner: string;
  bootstrapAdminToken: string;
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

  return {
    port,
    databasePath: requireEnv(env, 'DATABASE_PATH'),
    giteaUrl: requireEnv(env, 'GITEA_URL'),
    giteaAdminToken,
    giteaAdminTokenFile,
    giteaAdminUsername: env.GITEA_ADMIN_USERNAME ?? 'admin',
    giteaAdminPassword: env.GITEA_ADMIN_PASSWORD,
    repoOwner: env.GITEA_REPO_OWNER ?? 'esl-skills',
    bootstrapAdminToken: env.ESL_BOOTSTRAP_ADMIN_TOKEN ?? 'bootstrap-token'
  };
}
