import { parseSkillName } from '@esl/core';
import type { FastifyInstance } from 'fastify';
import type { SkillRepository } from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';

export interface SkillsRouteOptions {
  repository: SkillRepository;
  giteaService: GiteaService;
}

export function registerSkillsRoutes(app: FastifyInstance, options: SkillsRouteOptions): void {
  const { repository, giteaService } = options;

  app.post('/api/skills', async (request, reply) => {
    const authorization = request.headers.authorization;
    if (!authorization || !authorization.startsWith('token ')) {
      return reply.status(401).send({ error: 'Unauthorized: missing token' });
    }

    const token = authorization.replace('token ', '').trim();
    const user = await giteaService.validateToken(token);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized: invalid Gitea token' });
    }

    const { name, description, version, visibility = 'public' } = request.body as {
      name: string;
      description: string;
      version: string;
      visibility?: string;
    };
    const { scope, skillName } = parseSkillName(name);

    let skill = repository.getSkill(name);
    if (!skill) {
      const gitRepo = await giteaService.createRepo(scope, skillName, visibility === 'private');
      repository.createSkill({
        name,
        scope,
        skillName,
        description,
        author: user.username,
        visibility,
        gitRepoPath: gitRepo.full_name
      });
      skill = repository.getSkill(name)!;
    }

    repository.addVersion(name, version);
    return reply.status(201).send(skill);
  });

  app.get('/api/skills/search', async (request) => {
    const { q = '' } = request.query as { q?: string };
    return repository.searchSkills(q);
  });

  app.get('/api/skills/*', async (request, reply) => {
    const rawName = (request.params as { '*': string })['*'];
    const name = decodeURIComponent(rawName);
    const skill = repository.getSkill(name);
    if (!skill) {
      return reply.status(404).send({ error: 'Skill not found' });
    }

    return { ...skill, versions: repository.getVersions(name) };
  });
}
