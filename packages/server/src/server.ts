import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildApp } from './app.js';
import { loadServerConfig, type ServerConfig } from './config.js';
import { GiteaService } from './services/gitea.js';

export interface StartServerOptions {
  env?: NodeJS.ProcessEnv;
  listen?: FastifyInstance['listen'];
  readFile?: typeof readFile;
}

async function resolveGiteaAdminToken(
  config: ServerConfig,
  readTokenFile: typeof readFile
): Promise<string> {
  if (config.giteaAdminToken) {
    return config.giteaAdminToken;
  }

  if (!config.giteaAdminTokenFile) {
    throw new Error('Missing required environment variable: GITEA_ADMIN_TOKEN or GITEA_ADMIN_TOKEN_FILE');
  }

  let token: string;
  try {
    token = (await readTokenFile(config.giteaAdminTokenFile, 'utf8')).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read Gitea admin token file: ${config.giteaAdminTokenFile}: ${message}`);
  }

  if (!token) {
    throw new Error(`Gitea admin token file is empty: ${config.giteaAdminTokenFile}`);
  }

  return token;
}

export async function startServer(options: StartServerOptions = {}): Promise<FastifyInstance> {
  const config = loadServerConfig(options.env);
  const adminToken = await resolveGiteaAdminToken(config, options.readFile ?? readFile);
  const app = buildApp({
    dbPath: config.databasePath,
    giteaService: new GiteaService(config.giteaUrl, adminToken),
    repoOwner: config.repoOwner,
    bootstrapAdminToken: config.bootstrapAdminToken
  });

  const listen = options.listen?.bind(app) ?? app.listen.bind(app);
  await listen({ port: config.port, host: '0.0.0.0' });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer()
    .then(() => {
      console.log('ESL API Server started');
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
