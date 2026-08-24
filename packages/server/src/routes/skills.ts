import { parseSkillName } from '@esl/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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

  app.post('/api/skills/upload', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized: invalid token' });
    }

    const body = request.body as { name?: string; description?: string };
    const shortName = body.name ?? '';
    if (!/^[a-z0-9-]{1,64}$/.test(shortName)) {
      return reply.status(400).send({ error: 'Skill name must use lowercase letters, digits, and hyphens' });
    }
    if (!body.description) {
      return reply.status(400).send({ error: 'Skill description is required' });
    }

    const name = `@${repoOwner}/${shortName}`;
    if (repository.getSkill(name)) {
      return reply.status(409).send({ error: 'Skill already exists; use source and Git push to update it' });
    }

    const gitRepo = await giteaService.createOrganizationRepo(repoOwner, shortName, true);
    const skill = repository.createServerSkill({
      name,
      scope: repoOwner,
      skillName: shortName,
      description: body.description,
      createdBy: user.username,
      owner: user.username,
      maintainers: [user.username],
      visibility: 'private',
      gitRepoPath: gitRepo.full_name,
      status: 'active-unreleased'
    });
    return reply.status(201).send(withCloneUrl(request, { ...skill, versions: repository.getVersions(name) }));
  });

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
      return createSkill(request, reply, repository, giteaService, repoOwner, eslUser.username, {
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
    return createSkill(request, reply, repository, giteaService, repoOwner, user.username, {
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

  app.post('/api/skills/:scope/:skillName/rename', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string };
    const currentName = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(currentName);
    const nextShortName = (request.body as { name?: string }).name ?? '';
    if (!user || !skill || (skill.owner !== user.username && !skill.maintainers.includes(user.username))) {
      return reply.status(403).send({ error: 'Forbidden: Maintainer permission required' });
    }
    if (!/^[a-z0-9-]{1,64}$/.test(nextShortName)) {
      return reply.status(400).send({ error: 'Skill name must use lowercase letters, digits, and hyphens' });
    }
    const nextName = `@${repoOwner}/${nextShortName}`;
    await giteaService.renameRepo(repoOwner, skill.skillName, nextShortName);
    const renamed = repository.renameSkill(currentName, nextName, nextShortName);
    return reply.send(withCloneUrl(request, { ...renamed, versions: repository.getVersions(nextName) }));
  });

  app.post('/api/skills/:scope/:skillName/archive', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(name);
    if (!user || !skill || (skill.owner !== user.username && !skill.maintainers.includes(user.username))) {
      return reply.status(403).send({ error: 'Forbidden: Maintainer permission required' });
    }
    repository.archiveSkill(name);
    return reply.send(repository.getSkill(name));
  });

  app.post('/api/skills/:scope/:skillName/restore', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    if (!(await authorizePlatformAdministrator(request, adminRepository, giteaService))) {
      return reply.status(403).send({ error: 'Forbidden: platform administrator required' });
    }
    if (!repository.getSkill(name)) return reply.status(404).send({ error: 'Skill not found' });
    repository.restoreSkill(name);
    return reply.send(repository.getSkill(name));
  });

  app.get('/api/skills/*', async (request, reply) => {
    const rawName = (request.params as { '*': string })['*'];
    const name = decodeURIComponent(rawName);
    const skill = repository.getSkill(name);
    const redirect = repository.resolveRedirect(name);
    if (!skill && redirect) {
      return reply.status(301).send({
        error: 'Skill renamed',
        oldName: name,
        currentName: redirect.currentName,
        skillId: redirect.skillId
      });
    }
    if (!skill) {
      return reply.status(404).send({ error: 'Skill not found' });
    }

    return withCloneUrl(request, { ...skill, versions: repository.getVersions(name) });
  });
}

async function authorizePlatformAdministrator(
  request: FastifyRequest,
  adminRepository: AdminRepository | undefined,
  giteaService: GiteaService
): Promise<boolean> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) return false;
  const token = authorization.replace('token ', '').trim();
  if (adminRepository?.getPlatformAdminForToken(token)) return true;
  return (await giteaService.validateAdminUserToken(token)) !== null;
}

async function authenticateSkillUser(
  request: FastifyRequest,
  adminRepository: AdminRepository | undefined,
  giteaService: GiteaService
): Promise<{ username: string } | null> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) return null;
  const token = authorization.replace('token ', '').trim();
  const eslUser = adminRepository?.validateUserToken(token);
  if (eslUser) return eslUser;
  if (adminRepository?.hasIssuedToken(token) || token.startsWith('esl_')) return null;
  const user = await giteaService.validateToken(token);
  return user ? { username: user.username } : null;
}

async function createSkill(
  request: FastifyRequest,
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
    repository.createServerSkill({
      name: input.name,
      scope,
      skillName,
      description: input.description,
      createdBy: username,
      owner: 'platform',
      maintainers: [username],
      visibility: input.visibility,
      gitRepoPath: gitRepo.full_name,
      status: 'active-published'
    });
    skill = repository.getSkill(input.name)!;
  }

  repository.addVersion(input.name, input.version);
  if (skill.status !== 'active-published' || !skill.skillId) {
    repository.markPublished(input.name);
    skill = repository.getSkill(input.name)!;
  }
  return reply.status(201).send(withCloneUrl(request, {
    ...skill,
    versions: repository.getVersions(input.name),
    publishedPackage: true
  }));
}

function withCloneUrl<T extends { gitRepoPath: string }>(request: FastifyRequest, skill: T): T & { cloneUrl: string } {
  const host = request.hostname.replace(/:80$/, '').replace(/:443$/, '');
  return {
    ...skill,
    cloneUrl: `${request.protocol}://${host}/git/${skill.gitRepoPath}.git`
  };
}
