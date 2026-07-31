import Fastify, { type FastifyInstance } from 'fastify';
import { initDatabase, SkillRepository } from './db/database.js';
import { registerSkillsRoutes } from './routes/skills.js';
import type { GiteaService } from './services/gitea.js';

export interface AppOptions {
  dbPath: string;
  giteaService: GiteaService;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = initDatabase(options.dbPath);
  const repository = new SkillRepository(db);

  app.get('/health', async () => ({ ok: true, service: 'esl-api' }));
  registerSkillsRoutes(app, { repository, giteaService: options.giteaService });
  app.addHook('onClose', () => db.close());

  return app;
}
