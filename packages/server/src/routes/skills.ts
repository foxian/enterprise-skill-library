import { parseSkillName } from '@esl/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AdminRepository, SkillRepository } from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';

export interface SkillsRouteOptions {
  repository: SkillRepository;
  adminRepository?: AdminRepository;
  giteaService: GiteaService;
  repoOwner: string;
}

export function registerSkillsRoutes(app: FastifyInstance, options: SkillsRouteOptions): void {
  const { repository, adminRepository, giteaService, repoOwner } = options;

  app.post('/api/skills', async (request, reply) => {
    const authorization = request.headers.authorization;
    if (!authorization || !authorization.startsWith('token ')) {
      return reply.status(401).send({ error: 'Unauthorized: missing token' });
    }

    const token = authorization.replace('token ', '').trim();
    const eslUser = adminRepository?.validateUserToken(token);
    if (eslUser) {
      const { name, description, version, visibility = 'public' } = request.body as {
        name: string;
        description: string;
        version: string;
        visibility?: string;
      };
      return createSkill(reply, repository, giteaService, repoOwner, eslUser.username, {
        name,
        description,
        version,
        visibility
      });
    }

    if (adminRepository?.hasIssuedToken(token) || token.startsWith('esl_')) {
      return reply.status(401).send({ error: 'Unauthorized: invalid token' });
    }

    const user = await giteaService.validateToken(token);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized: invalid token' });
    }

    const { name, description, version, visibility = 'public' } = request.body as {
      name: string;
      description: string;
      version: string;
      visibility?: string;
    };
    return createSkill(reply, repository, giteaService, repoOwner, user.username, {
      name,
      description,
      version,
      visibility
    });
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

async function createSkill(
  reply: FastifyReply,
  repository: SkillRepository,
  giteaService: GiteaService,
  repoOwner: string,
  username: string,
  input: { name: string; description: string; version: string; visibility: string }
) {
  const { scope, skillName } = parseSkillName(input.name);

  let skill = repository.getSkill(input.name);
  if (!skill) {
    const repoName = `${scope}_${skillName}`;
    const gitRepo = await giteaService.createOrganizationRepo(
      repoOwner,
      repoName,
      input.visibility === 'private'
    );
    repository.createSkill({
      name: input.name,
      scope,
      skillName,
      description: input.description,
      createdBy: username,
      owner: 'platform',
      maintainers: [username],
      visibility: input.visibility,
      gitRepoPath: gitRepo.full_name
    });
    skill = repository.getSkill(input.name)!;
  }

  repository.addVersion(input.name, input.version);
  return reply.status(201).send(skill);
}
