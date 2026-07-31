export interface ServerConfig {
  port: number;
  databasePath: string;
  giteaUrl: string;
  giteaAdminToken: string;
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

  return {
    port,
    databasePath: requireEnv(env, 'DATABASE_PATH'),
    giteaUrl: requireEnv(env, 'GITEA_URL'),
    giteaAdminToken: requireEnv(env, 'GITEA_ADMIN_TOKEN')
  };
}
