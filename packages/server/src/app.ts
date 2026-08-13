import Fastify, { type FastifyInstance } from 'fastify';
import { AdminRepository, initDatabase, SkillRepository } from './db/database.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerSkillsRoutes } from './routes/skills.js';
import type { GiteaService } from './services/gitea.js';

export interface AppOptions {
  dbPath: string;
  giteaService: GiteaService;
  repoOwner: string;
  bootstrapAdminToken?: string;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = initDatabase(options.dbPath);
  const repository = new SkillRepository(db);
  const adminRepository = new AdminRepository(db, options.bootstrapAdminToken ?? 'bootstrap-token');

  app.get('/health', async () => ({ ok: true, service: 'esl-api' }));
  registerAdminRoutes(app, {
    repository: adminRepository,
    giteaService: options.giteaService,
    repoOwner: options.repoOwner
  });
  registerSkillsRoutes(app, {
    repository,
    adminRepository,
    giteaService: options.giteaService,
    repoOwner: options.repoOwner
  });
  app.addHook('onClose', () => db.close());

  return app;
}
