import Fastify, { type FastifyInstance } from 'fastify';
import { AdminRepository, initDatabase, SkillRepository } from './db/database.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSkillsRoutes } from './routes/skills.js';
import type { GiteaService } from './services/gitea.js';
import path from 'node:path';

export interface AppOptions {
  dbPath: string;
  packageRoot?: string;
  giteaService: GiteaService;
  repoOwner: string;
  bootstrapAdminToken?: string;
}

export function buildApp(options: AppOptions): FastifyInstance {
  // bodyLimit matches the nginx client_max_body_size so publish requests carrying
  // the full source tree are not rejected by the 1MB Fastify default.
  const app = Fastify({ logger: false, bodyLimit: 200 * 1024 * 1024 });
  const db = initDatabase(options.dbPath);
  const repository = new SkillRepository(db);
  const adminRepository = new AdminRepository(db, options.bootstrapAdminToken ?? 'bootstrap-token');

  app.get('/health', async () => ({ ok: true, service: 'esl-api' }));
  registerAuthRoutes(app, {
    repository: adminRepository,
    giteaService: options.giteaService
  });
  registerAdminRoutes(app, {
    repository: adminRepository,
    giteaService: options.giteaService,
    repoOwner: options.repoOwner
  });
  registerSkillsRoutes(app, {
    repository,
    adminRepository,
    giteaService: options.giteaService,
    repoOwner: options.repoOwner,
    packageRoot: options.packageRoot ?? path.join(path.dirname(options.dbPath), 'packages')
  });
  app.addHook('onClose', () => db.close());

  return app;
}
