import { parseSkillName, validateReleaseManifest } from '@esl/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import semver from 'semver';
import type { AdminRepository, OperationRepository, SkillRecord, SkillRepository } from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import type { OperationExecutor } from '../services/operation-executor.js';
import type { PermissionChangePayload } from '../services/skill-operations.js';

export interface SkillsRouteOptions {
  repository: SkillRepository;
  adminRepository?: AdminRepository;
  giteaService: GiteaService;
  repoOwner: string;
  packageRoot?: string;
  operationRepository: OperationRepository;
  operationExecutor: OperationExecutor;
}

export function registerSkillsRoutes(app: FastifyInstance, options: SkillsRouteOptions): void {
  const { repository, adminRepository, giteaService, repoOwner, operationRepository, operationExecutor } = options;
  const packageRoot = options.packageRoot ?? path.resolve(process.cwd(), 'data', 'packages');

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
    const existing = repository.getSkill(name);
    if (existing) {
      if (existing.status !== 'active-unreleased' || existing.createdBy !== user.username) {
        return reply.status(409).send({ error: 'Skill already exists; use source and Git push to update it' });
      }
      // An interrupted first Source Upload: the same creator may resume against
      // the Active Unreleased Skill Source instead of hitting a duplicate error.
      return reply
        .status(200)
        .send(withCloneUrl(request, { ...existing, versions: repository.getVersions(name) }));
    }

    let gitRepo: { full_name: string } | undefined;
    let skill: ReturnType<SkillRepository['createServerSkill']> | undefined;
    try {
      gitRepo = await giteaService.createOrganizationRepo(repoOwner, shortName, true);
      if (typeof giteaService.addCollaborator === 'function') {
        await giteaService.addCollaborator(repoOwner, shortName, user.username, 'write');
      }
      skill = repository.createServerSkill({
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
    } catch (error) {
      // The Git repository may already have been created; best-effort remove the
      // orphan so the same skill name can be uploaded again.
      if (gitRepo && typeof giteaService.deleteRepo === 'function') {
        try {
          await giteaService.deleteRepo(repoOwner, shortName);
        } catch {
          // Best-effort cleanup; the original failure is the one to surface.
        }
      }
      throw error;
    }
    return reply.status(201).send(withCloneUrl(request, { ...skill!, versions: repository.getVersions(name) }));
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
      return createSkill(request, reply, options, eslUser.username, {
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
    return createSkill(request, reply, options, user.username, {
      name,
      description,
      version,
      visibility
    });
  });

  app.get('/api/skills/search', async (request) => {
    const { q = '' } = request.query as { q?: string };
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return [];
    }
    const accessible: SkillRecord[] = [];
    for (const skill of repository.searchSkills(q)) {
      if (await hasReadAccess(giteaService, skill, user.username)) {
        accessible.push(skill);
      }
    }
    return accessible;
  });

  app.get('/api/skills/:scope/:skillName/permissions', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized: invalid token' });
    }
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const skill = repository.getSkill(name);
    if (!skill) {
      return reply.status(404).send({ error: 'Skill not found' });
    }
    if (!canManageSkill(skill, user.username)) {
      return reply.status(403).send({ error: 'Forbidden: skill owner or organization administrator required' });
    }
    return getPermissionMatrix(giteaService, skill);
  });

  app.post('/api/skills/:scope/:skillName/permissions', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized: invalid token' });
    }
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const skill = repository.getSkill(name);
    if (!skill) {
      return reply.status(404).send({ error: 'Skill not found' });
    }
    if (!canManageSkill(skill, user.username)) {
      return reply.status(403).send({ error: 'Forbidden: skill owner or organization administrator required' });
    }

    const body = request.body as { action?: string; team?: string; username?: string; permission?: string };
    const repo = skillRepo(skill);
    // 路由侧只做无副作用的参数与目标校验,实际的 Gitea 变更经 Operation 执行,
    // 失败时可查询、可重试;Gitea 始终是权限的事实来源。
    let payload: PermissionChangePayload;
    switch (body.action) {
      case 'share_all_read':
      case 'share_all_write': {
        const teamName = body.action === 'share_all_read' ? 'all-readers' : 'all-writers';
        const team = (await giteaService.listTeams(skill.scope)).find((entry) => entry.name === teamName);
        if (!team) {
          return reply.status(404).send({ error: `Default team ${teamName} not found in organization` });
        }
        payload = { skillName: name, scope: skill.scope, repoOwner: repo.owner, repoName: repo.name, action: body.action, teamId: team.id };
        break;
      }
      case 'add_team':
      case 'remove_team': {
        if (!body.team) {
          return reply.status(400).send({ error: 'Team name is required' });
        }
        const team = (await giteaService.listTeams(skill.scope)).find((entry) => entry.name === body.team);
        if (!team) {
          return reply.status(404).send({ error: 'Team not found in organization' });
        }
        payload = { skillName: name, scope: skill.scope, repoOwner: repo.owner, repoName: repo.name, action: body.action, teamId: team.id };
        break;
      }
      case 'add_member': {
        if (!body.username || (body.permission !== 'read' && body.permission !== 'write')) {
          return reply.status(400).send({ error: 'Username and a read or write permission are required' });
        }
        payload = { skillName: name, scope: skill.scope, repoOwner: repo.owner, repoName: repo.name, action: body.action, username: body.username, permission: body.permission };
        break;
      }
      case 'remove_member': {
        if (!body.username) {
          return reply.status(400).send({ error: 'Username is required' });
        }
        payload = { skillName: name, scope: skill.scope, repoOwner: repo.owner, repoName: repo.name, action: body.action, username: body.username };
        break;
      }
      case 'reset_to_private': {
        payload = { skillName: name, scope: skill.scope, repoOwner: repo.owner, repoName: repo.name, action: body.action, skillOwner: skill.owner };
        break;
      }
      default:
        return reply.status(400).send({ error: 'Unknown permission action' });
    }

    const suppliedKey = request.headers['idempotency-key'];
    const clientKey = Array.isArray(suppliedKey) ? suppliedKey[0] : suppliedKey;
    const operation = await runIdempotentOperation(operationRepository, operationExecutor, {
      idempotencyKey: `skill.permission:${name}:${body.action}:${clientKey ?? crypto.randomUUID()}`,
      kind: 'skill.permission',
      payload
    });
    if (operation.status !== 'succeeded') {
      return reply.status(409).send({
        error: operation.error?.message ?? 'Permission change failed',
        operationId: operation.id,
        status: operation.status,
        retryable: true
      });
    }
    return getPermissionMatrix(giteaService, skill);
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
    const repo = skillRepo(skill);
    const nextName = `@${skill.scope}/${nextShortName}`;
    if (repository.getSkill(nextName)) {
      return reply.status(409).send({ error: 'Skill name already exists' });
    }
    let metadataUpdated = false;
    let repoRenamed = false;
    try {
      if (typeof giteaService.updateSkillName === 'function') {
        await giteaService.updateSkillName(repo.owner, repo.name, nextShortName);
        metadataUpdated = true;
      }
      await giteaService.renameRepo(repo.owner, repo.name, nextShortName);
      repoRenamed = true;
      const renamed = repository.renameSkill(
        currentName,
        nextName,
        nextShortName,
        `${repo.owner}/${nextShortName}`
      );
      return reply.send(withCloneUrl(request, { ...renamed, versions: repository.getVersions(nextName) }));
    } catch (error) {
      if (repoRenamed) {
        try {
          await giteaService.renameRepo(repo.owner, nextShortName, repo.name);
        } catch {
        }
      }
      if (metadataUpdated && typeof giteaService.updateSkillName === 'function') {
        try {
          await giteaService.updateSkillName(repo.owner, nextShortName, repo.name);
        } catch {
        }
      }
      return reply.status(409).send({
        error: `Skill rename failed; rollback attempted: ${(error as Error).message}`,
        retryable: true
      });
    }
  });

  app.post('/api/skills/:scope/:skillName/source-access', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(name);
    if (!user || !skill) {
      return reply.status(404).send({ error: 'Skill not found' });
    }
    if (typeof giteaService.addCollaborator === 'function') {
      try {
        const repo = skillRepo(skill);
        await giteaService.addCollaborator(repo.owner, repo.name, user.username, 'read');
      } catch (error) {
        return reply.status(409).send({ error: (error as Error).message });
      }
    }
    return reply.send(withCloneUrl(request, skill));
  });

  app.post('/api/skills/:scope/:skillName/releases', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(name);
    if (!user || !skill || !skill.maintainers.includes(user.username)) {
      return reply.status(403).send({ error: 'Forbidden: Maintainer permission required' });
    }
    if (skill.status === 'archived') {
      return reply.status(409).send({ error: 'Archived skills cannot create releases' });
    }

    const body = request.body as {
      version?: string;
      sourceCommit?: string;
      releaseManifest?: unknown;
      files?: Record<string, string>;
      notes?: string;
    };
    if (!body.version || !semver.valid(body.version)) {
      return reply.status(400).send({ error: 'Release version must be valid SemVer' });
    }
    if (!body.sourceCommit) {
      return reply.status(400).send({ error: 'sourceCommit is required' });
    }
    const repo = skillRepo(skill);
    const sourceFiles = typeof giteaService.readSourceTree === 'function'
      ? await giteaService.readSourceTree(repo.owner, repo.name, body.sourceCommit)
      : body.files ?? {};
    let sourceManifest: unknown = body.releaseManifest;
    if (sourceFiles['release.json']) {
      try {
        sourceManifest = JSON.parse(sourceFiles['release.json']);
      } catch {
        return reply.status(400).send({ error: 'release.json is not valid JSON' });
      }
    }
    const manifest = validateReleaseManifest(sourceManifest);
    if (!manifest.success) {
      return reply.status(400).send({ error: manifest.errors.join(', ') });
    }
    if (!skill.skillId) {
      return reply.status(409).send({ error: 'Skill has no Skill ID' });
    }
    if (repository.getRelease(name, body.version)) {
      return reply.status(409).send({ error: `Skill Release ${body.version} already exists` });
    }
    const releaseTag = `v${body.version}`;
    let existingReleaseTag: { target: string } | null = null;
    if (typeof giteaService.getReleaseTag === 'function') {
      existingReleaseTag = await giteaService.getReleaseTag(repo.owner, repo.name, releaseTag);
      if (existingReleaseTag && existingReleaseTag.target !== body.sourceCommit) {
        return reply.status(409).send({
          error: `Release Tag ${releaseTag} points to ${existingReleaseTag.target}, expected ${body.sourceCommit}`
        });
      }
    }

    let dependencyLock: Record<string, unknown>;
    try {
      dependencyLock = resolveDependencyLock(repository, name, manifest.data.dependencies);
    } catch (error) {
      return reply.status(409).send({ error: (error as Error).message });
    }

    const publishedFiles = { ...sourceFiles };
    if (publishedFiles['SKILL.md']) {
      publishedFiles['SKILL.md'] = publishedFiles['SKILL.md'].replace(
        /^(---\r?\n)([\s\S]*?)(\r?\n---)/,
        (_match, open: string, frontmatter: string, close: string) =>
          `${open}${frontmatter.replace(/(^name:\s*)[^\r\n]+/m, `$1${skill.scope}:${skill.skillName}`)}${close}`
      );
    }
    const contentChecksum = `sha256-${crypto.createHash('sha256')
      .update(JSON.stringify(publishedFiles))
      .digest('hex')}`;
    publishedFiles['skill.json'] = `${JSON.stringify({
      name,
      version: body.version,
      skillId: skill.skillId,
      sourceCommit: body.sourceCommit,
      contentChecksum,
      ...manifest.data
    }, null, 2)}\n`;
    const packageManifest = {
      name,
      skillId: skill.skillId,
      version: body.version,
      sourceCommit: body.sourceCommit,
      releaseManifest: manifest.data,
      dependencyLock,
      files: publishedFiles
    };
    const bytes = Buffer.from(JSON.stringify(packageManifest, null, 2));
    const checksum = `sha256-${crypto.createHash('sha256').update(bytes).digest('hex')}`;
    const packagePath = path.join(packageRoot, skill.skillId, body.version, `${checksum}.json`);
    await fs.mkdir(path.dirname(packagePath), { recursive: true });
    await fs.writeFile(packagePath, bytes, { flag: 'wx' });

    let release;
    try {
      release = repository.createRelease({
        skillId: skill.skillId,
        skillName: name,
        version: body.version,
        sourceCommit: body.sourceCommit,
        packagePath,
        checksum,
        releaseManifest: manifest.data,
        dependencyLock,
        notes: body.notes,
        createdBy: user.username
      });
    } catch (error) {
      await fs.rm(packagePath, { force: true });
      if (String(error).toLowerCase().includes('unique')) {
        return reply.status(409).send({ error: `Skill Release ${body.version} already exists` });
      }
      throw error;
    }
    let tagPending = false;
    if (typeof giteaService.createReleaseTag === 'function' && !existingReleaseTag) {
      try {
        await giteaService.createReleaseTag(
          repo.owner,
          repo.name,
          releaseTag,
          body.sourceCommit,
          body.notes?.trim() || `Release ${name} ${body.version}`
        );
      } catch {
        tagPending = true;
      }
    }
    repository.addVersion(name, body.version);
    if (skill.status !== 'active-published') repository.markPublished(name);
    return reply.status(201).send({
      ...release,
      status: 'published',
      tagPending,
      packageUrl: `/api/packages/${skill.skillId}/${body.version}/${checksum}.json`
    });
  });

  app.post('/api/skills/:scope/:skillName/releases/:version/repair-tag', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string; version: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(name);
    if (!user || !skill || !skill.maintainers.includes(user.username)) {
      return reply.status(403).send({ error: 'Forbidden: Maintainer permission required' });
    }
    const release = repository.getRelease(name, decodeURIComponent(params.version));
    if (!release) {
      return reply.status(404).send({ error: 'Skill Release not found' });
    }
    if (typeof giteaService.getReleaseTag !== 'function') {
      return reply.status(501).send({ error: 'Release Tag repair is not supported by the Git backend' });
    }

    const tag = `v${release.version}`;
    const repo = skillRepo(skill);
    const existing = await giteaService.getReleaseTag(repo.owner, repo.name, tag);
    if (existing) {
      if (existing.target !== release.sourceCommit) {
        return reply.status(409).send({
          error: `Release Tag ${tag} points to ${existing.target}, expected ${release.sourceCommit}`
        });
      }
      return reply.send({
        repaired: false,
        tag,
        sourceCommit: release.sourceCommit
      });
    }

    try {
      await giteaService.createReleaseTag(
        repo.owner,
        repo.name,
        tag,
        release.sourceCommit,
        `Release ${name} ${release.version}`
      );
    } catch (error) {
      return reply.status(409).send({ error: (error as Error).message });
    }
    return reply.send({
      repaired: true,
      tag,
      sourceCommit: release.sourceCommit
    });
  });

  app.get('/api/packages/:skillId/:version/:checksum', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized: invalid token' });
    }
    const params = request.params as { skillId: string; version: string; checksum: string };
    if (![params.skillId, params.version, params.checksum].every((value) => /^[A-Za-z0-9._-]+$/.test(value))) {
      return reply.status(400).send({ error: 'Invalid Published Skill Package path' });
    }
    const skill = repository.getSkillById(params.skillId);
    if (!skill) {
      return reply.status(404).send({ error: 'Skill not found' });
    }
    if (!(await hasReadAccess(giteaService, skill, user.username))) {
      return reply.status(403).send({ error: 'Forbidden: read access required' });
    }
    const packagePath = path.join(packageRoot, params.skillId, params.version, params.checksum);
    try {
      const bytes = await fs.readFile(packagePath);
      return reply.type('application/json').send(bytes);
    } catch {
      return reply.status(404).send({ error: 'Published Skill Package not found' });
    }
  });

  app.post('/api/skills/:scope/:skillName/releases/:version/notes', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string; version: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(name);
    if (!user || !skill || !skill.maintainers.includes(user.username)) {
      return reply.status(403).send({ error: 'Forbidden: Maintainer permission required' });
    }
    const version = decodeURIComponent(params.version);
    const body = request.body as { message?: string };
    if (typeof body.message !== 'string') {
      return reply.status(400).send({ error: 'Release notes message is required' });
    }
    const updated = repository.updateReleaseNotes(name, version, body.message);
    if (!updated) {
      return reply.status(404).send({ error: 'Skill Release not found' });
    }
    return reply.send(updated);
  });

  app.post('/api/skills/:scope/:skillName/archive', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(name);
    if (!user || !skill || (skill.owner !== user.username && !skill.maintainers.includes(user.username))) {
      return reply.status(403).send({ error: 'Forbidden: Maintainer permission required' });
    }
    if (typeof giteaService.setRepositoryArchived === 'function') {
      try {
        const repo = skillRepo(skill);
        await giteaService.setRepositoryArchived(repo.owner, repo.name, true);
      } catch (error) {
        return reply.status(409).send({ error: (error as Error).message });
      }
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
    const restored = repository.getSkill(name);
    if (restored && typeof giteaService.setRepositoryArchived === 'function') {
      try {
        const repo = skillRepo(restored);
        await giteaService.setRepositoryArchived(repo.owner, repo.name, false);
      } catch (error) {
        return reply.status(409).send({ error: (error as Error).message });
      }
    }
    repository.restoreSkill(name);
    return reply.send(repository.getSkill(name));
  });

  app.post('/api/skills/:scope/:skillName/delete', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    if (!(await authorizePlatformAdministrator(request, adminRepository, giteaService))) {
      return reply.status(403).send({ error: 'Forbidden: platform administrator required' });
    }
    const skill = repository.getSkill(name);
    if (!skill) {
      return reply.status(404).send({ error: 'Skill not found' });
    }
    const body = (request.body ?? {}) as { confirm?: string };
    if (body.confirm !== name) {
      return reply.status(400).send({ error: 'Deletion requires confirm matching the skill identity' });
    }
    if (typeof giteaService.deleteRepo === 'function') {
      try {
        const repo = skillRepo(skill);
        await giteaService.deleteRepo(repo.owner, repo.name);
      } catch {
        // Best-effort: an orphan Git repository may remain, but the skill record
        // and its artifacts must still be removed.
      }
    }
    if (skill.skillId) {
      await fs.rm(path.join(packageRoot, skill.skillId), { recursive: true, force: true });
    }
    const deleted = repository.deleteSkill(name);
    return reply.send({ deleted: true, name, skillId: deleted.skillId, releasesRemoved: deleted.releases });
  });

  app.get('/api/skills/*', async (request, reply) => {
    const rawName = (request.params as { '*': string })['*'];
    const unscoped = decodeURIComponent(rawName);
    // 与其它技能路由保持一致：允许调用方省略 @ 前缀，统一解析为 "@scope/skillName"。
    const name = `${unscoped.startsWith('@') ? '' : '@'}${unscoped}`;
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
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!(await hasReadAccess(giteaService, skill, user?.username))) {
      return reply.status(403).send({ error: 'Forbidden: read access required' });
    }

    const releases = repository.getReleases(name);
    const latest = releases[0];
    return withCloneUrl(request, {
      ...skill,
      versions: repository.getVersions(name),
      releases: releases.map((release) => ({
        ...release,
        packageUrl: `${requestOrigin(request)}/api/packages/${release.skillId}/${release.version}/${path.basename(release.packagePath)}`
      })),
      packageUrl: latest
        ? `${requestOrigin(request)}/api/packages/${latest.skillId}/${latest.version}/${path.basename(latest.packagePath)}`
        : undefined
    });
  });
}

function resolveDependencyLock(
  repository: SkillRepository,
  rootName: string,
  dependencies: Record<string, string>
): Record<string, { skillId: string; version: string; checksum: string }> {
  const lock: Record<string, { skillId: string; version: string; checksum: string }> = {};
  const visiting = new Set<string>([rootName]);

  const visit = (name: string, range: string): void => {
    if (visiting.has(name)) {
      throw new Error(`Dependency cycle detected: ${[...visiting, name].join(' -> ')}`);
    }
    const releases = repository.getReleases(name);
    const selected = releases.find((release) => semver.satisfies(release.version, range));
    if (!selected?.skillId) {
      throw new Error(`Dependency ${name}@${range} has no published Release`);
    }
    lock[name] = {
      skillId: selected.skillId,
      version: selected.version,
      checksum: selected.checksum
    };
    visiting.add(name);
    const releaseManifest = selected.releaseManifest as { dependencies?: Record<string, string> };
    for (const [dependency, dependencyRange] of Object.entries(releaseManifest.dependencies ?? {})) {
      visit(dependency, dependencyRange);
    }
    visiting.delete(name);
  };

  for (const [name, range] of Object.entries(dependencies)) {
    visit(name, range);
  }
  return lock;
}

// 从技能记录的 gitRepoPath（如 "e2e223219/e2e223219_demo-skill"）解析 Gitea 仓库
// 属主与仓库名。CLI 上传流的仓库为 "{repoOwner}/{skillName}"，而 API 创建的
// 组织级技能仓库为 "{scope}/{scope}_{skillName}"，故不能直接用 scope/skillName 重建路径。
function skillRepo(skill: SkillRecord): { owner: string; name: string } {
  const slash = skill.gitRepoPath.indexOf('/');
  return {
    owner: skill.gitRepoPath.slice(0, slash),
    name: skill.gitRepoPath.slice(slash + 1)
  };
}

async function hasReadAccess(
  giteaService: GiteaService,
  skill: SkillRecord,
  username: string | undefined
): Promise<boolean> {
  if (!username) return false;
  // public 技能对任何已登录用户可读,无需向 Git Backend 查询权限。
  // 也避免对 DB 中存在但 Gitea 侧仓库缺失的孤儿记录触发 Gitea 调用。
  if (skill.visibility === 'public') return true;
  if (username === `${skill.scope}_admin`) return true;
  // 技能创建者/维护者拥有管理权，理应可读自己的仓库（API 创建流未自动添加 collaborator）
  if (username === skill.owner || skill.maintainers.includes(username)) return true;
  const hasPermissionSupport =
    typeof giteaService.listRepoTeams === 'function' || typeof giteaService.isCollaborator === 'function';
  if (!hasPermissionSupport) {
    // Git backends without permission APIs cannot be filtered; keep legacy behavior.
    return true;
  }
  if (typeof giteaService.listRepoTeams === 'function' && typeof giteaService.isTeamMember === 'function') {
    const repo = skillRepo(skill);
    for (const team of await giteaService.listRepoTeams(repo.owner, repo.name)) {
      if (await giteaService.isTeamMember(team.id, username)) {
        return true;
      }
    }
  }
  if (typeof giteaService.isCollaborator === 'function') {
    const repo = skillRepo(skill);
    return giteaService.isCollaborator(repo.owner, repo.name, username);
  }
  return false;
}

function canManageSkill(skill: SkillRecord, username: string): boolean {
  return (
    skill.owner === username || skill.maintainers.includes(username) || username === `${skill.scope}_admin`
  );
}

async function getPermissionMatrix(giteaService: GiteaService, skill: SkillRecord) {
  const repo = skillRepo(skill);
  const repoTeams =
    typeof giteaService.listRepoTeams === 'function'
      ? await giteaService.listRepoTeams(repo.owner, repo.name)
      : [];
  const members =
    typeof giteaService.listCollaborators === 'function'
      ? await giteaService.listCollaborators(repo.owner, repo.name)
      : [];
  const memberViews = [];
  for (const member of members) {
    const permission =
      typeof giteaService.getCollaboratorPermission === 'function'
        ? await giteaService.getCollaboratorPermission(repo.owner, repo.name, member.username)
        : 'read';
    memberViews.push({ username: member.username, permission });
  }
  return {
    scope: skill.scope,
    skillName: skill.skillName,
    sharedAllRead: repoTeams.some((team) => team.name === 'all-readers'),
    sharedAllWrite: repoTeams.some((team) => team.name === 'all-writers'),
    teams: repoTeams.filter((team) => !['all-readers', 'all-writers', 'Owners'].includes(team.name)),
    members: memberViews
  };
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

// 运行一个以幂等键收敛的 Operation:已有失败终态的操作随本次请求重试,
// 其余情况由执行器按租约与终态保护处理;返回重取后的最新操作记录。
async function runIdempotentOperation(
  operationRepository: OperationRepository,
  operationExecutor: OperationExecutor,
  input: { idempotencyKey: string; kind: string; payload: unknown }
) {
  let operation = operationRepository.getOperationByIdempotencyKey(input.idempotencyKey);
  if (!operation) {
    operation = operationRepository.createOperation(input);
  }
  if (operation.status === 'failed' || operation.status === 'permanently_failed') {
    operation = operationRepository.retryOperation(operation.id)!;
  }
  await operationExecutor.process(operation.id);
  return operationRepository.getOperation(operation.id)!;
}

async function createSkill(
  request: FastifyRequest,
  reply: FastifyReply,
  options: SkillsRouteOptions,
  username: string,
  input: { name: string; description: string; version: string; visibility: string }
) {
  const { repository, giteaService, operationRepository, operationExecutor } = options;
  const { scope, skillName } = parseSkillName(input.name);

  let skill = repository.getSkill(input.name);
  if (!skill) {
    // 技能仓库创建与 Skill Identity 登记接入统一 Operation 模型:
    // 幂等键收敛重复请求,失败落库可查询、可重试,成功后正常返回发布结果。
    const operation = await runIdempotentOperation(operationRepository, operationExecutor, {
      idempotencyKey: `skill.create:${input.name}`,
      kind: 'skill.create',
      payload: {
        name: input.name,
        scope,
        skillName,
        description: input.description,
        visibility: input.visibility,
        username
      }
    });
    if (operation.status !== 'succeeded') {
      return reply.status(409).send({
        error: operation.error?.message ?? 'Skill creation failed',
        operationId: operation.id,
        status: operation.status,
        retryable: true
      });
    }
    skill = repository.getSkill(input.name)!;
  }

  // 幂等发布:同一版本重复请求收敛为当前状态,不重复登记
  if (repository.getVersions(input.name).includes(input.version)) {
    return reply.status(200).send(withCloneUrl(request, {
      ...skill!,
      versions: repository.getVersions(input.name),
      publishedPackage: true
    }));
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
  return {
    ...skill,
    cloneUrl: `${requestOrigin(request)}/git/${skill.gitRepoPath}.git`
  };
}

function requestOrigin(request: FastifyRequest): string {
  const forwardedProto = firstForwardedValue(request.headers['x-forwarded-proto']) ?? request.protocol;
  const forwardedHost = firstForwardedValue(request.headers['x-forwarded-host'])
    ?? request.hostname.replace(/:80$/, '').replace(/:443$/, '');
  return `${forwardedProto}://${forwardedHost}`;
}

function firstForwardedValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(',')[0]?.trim() || undefined;
}
