import type { FastifyInstance } from 'fastify';
import { pathToFileURL } from 'node:url';
import { buildApp } from './app.js';
import { loadServerConfig } from './config.js';
import { GiteaService } from './services/gitea.js';

export interface StartServerOptions {
  env?: NodeJS.ProcessEnv;
  listen?: FastifyInstance['listen'];
}

export async function startServer(options: StartServerOptions = {}): Promise<FastifyInstance> {
  const config = loadServerConfig(options.env);
  const app = buildApp({
    dbPath: config.databasePath,
    giteaService: new GiteaService(config.giteaUrl, config.giteaAdminToken)
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
