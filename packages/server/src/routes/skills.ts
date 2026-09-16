import {
  highestSatisfyingVersion,
  highestStableVersion,
  SHARE_TIER_TEAM_NAMES,
  STANDING_TEAM_NAMES,
  parseSkillName,
  parseSkillIdentity,
  sortVersionsDescending,
  validateReleaseManifest
} from '@esl/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import semver from 'semver';
import type {
  AdminRepository,
  SkillRecord,
  SkillRepository,
  SkillTeamGrantRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import type { GiteaService, GiteaTeam } from '../services/gitea.js';
import { isManagingMemberOf, isOwnerMemberOf } from '../services/organization-membership.js';
import { backendTeamName } from '../services/logical-team-projection.js';

export interface SkillsRouteOptions {
  repository: SkillRepository;
  adminRepository?: AdminRepository;
  giteaService: GiteaService;
  repoOwner: string;
  tenantOrganizationRepository: TenantOrganizationRepository;
  skillTeamGrantRepository: SkillTeamGrantRepository;
  packageRoot?: string;
}

export function registerSkillsRoutes(app: FastifyInstance, options: SkillsRouteOptions): void {
  const {
    repository,
    adminRepository,
    giteaService,
    repoOwner,
    tenantOrganizationRepository,
    skillTeamGrantRepository
  } = options;
  const packageRoot = options.packageRoot ?? path.resolve(process.cwd(), 'data', 'packages');

  // 权限矩阵的响应体;读路径(GET)与变更路径(POST)共用同一形状——客户端用响应整体
  // 替换本地状态,两个路由少一个字段就会让界面状态退化(变更后控件集体失效)。
  const buildPermissionsResponse = async (skill: SkillRecord, username: string) => ({
    ...(await getPermissionMatrix(
      giteaService,
      tenantOrganizationRepository,
      skillTeamGrantRepository,
      skill
    )),
    skill: buildSkillContext(repository, skill),
    // 查看者自己的权限档:与变更守门、技能列表的 access 用同一套判定(getAccessLevel),
    // 前端据此决定变更类控件是否可用,避免「点了才知道 403」。
    viewerAccess: await getAccessLevel(giteaService, skill, username)
  });

  app.post('/api/skills/upload', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized: invalid token' });
    }

    // ADR-0032:release.json v3 的 name 是归属的唯一权威来源。无 scope 的裸名
    // 解析为上传者个人命名空间;@scope/short 需上传者持有该命名空间(本人或
    // 组织成员)。身份在首次 Source Upload 固定。
    const body = request.body as { name?: string; description?: string };
    const identity = parseSkillIdentity(body.name ?? '');
    if (!identity) {
      return reply.status(400).send({ error: 'Skill name must use lowercase letters, digits, and hyphens' });
    }
    if (!body.description) {
      return reply.status(400).send({ error: 'Skill description is required' });
    }

    let scope: string;
    if (identity.scope === null || identity.scope === user.username) {
      scope = user.username;
    } else {
      // 组织命名空间:要求组织激活且上传者是成员(任何成员皆可 upload,ADR-0032)。
      const tenant = tenantOrganizationRepository.get(identity.scope);
      if (!tenant || tenant.status !== 'active') {
        return reply.status(403).send({
          error: `Organization ${identity.scope} is not active; it must be provisioned before uploading skills`
        });
      }
      let member = false;
      try {
        member = (await giteaService.listOrgMembers(identity.scope)).some((m) => m.username === user.username);
      } catch {
        member = false;
      }
      if (!member) {
        return reply.status(403).send({ error: `You are not a member of organization ${identity.scope}` });
      }
      scope = identity.scope;
    }

    const shortName = identity.shortName;
    const name = `@${scope}/${shortName}`;
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
      gitRepo = await giteaService.createRepo(scope, shortName, true);
      skill = repository.createServerSkill({
        name,
        scope,
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
          await giteaService.deleteRepo(scope, shortName);
        } catch {
          // Best-effort cleanup; the original failure is the one to surface.
        }
      }
      throw error;
    }
    return reply.status(201).send(withCloneUrl(request, { ...skill!, versions: repository.getVersions(name) }));
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

  // 角色化技能清单(ADR-0032):与 search(只返回已发布、面向安装消费)不同,
  // 这里返回调用方可见的全部技能(含未发布)及其权限关系,供管理后台的
  // "我管理的/共享给我的"与超管、所有者成员视图消费。可见性 = public ∪
  // 被授权 private,跨命名空间不再按调用者组织隔离;
  // relation: managed=持有管理权, shared=可读/可写但无管理权。
  app.get('/api/skills/inventory', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized: invalid token' });
    }
    const view: Array<SkillRecord & { access: SkillAccessLevel; relation: 'managed' | 'shared' }> = [];
    for (const skill of repository.listSkills()) {
      const access = await getAccessLevel(giteaService, skill, user.username);
      if (access === 'none') continue;
      view.push({ ...skill, access, relation: access === 'manage' ? 'managed' : 'shared' });
    }
    return view;
  });

  // 可见性切换(ADR-0033):Maintainer 或所有者成员可在 public/private
  // 间切换。public = 平台全员可搜可装可作依赖;private = 仅 Maintainer 与被授权者。
  app.post('/api/skills/:scope/:skillName/visibility', async (request, reply) => {
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
    if (!(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send({ error: 'Forbidden: manage permission required' });
    }
    const { visibility = '' } = request.body as { visibility?: string };
    if (visibility !== 'public' && visibility !== 'private') {
      return reply.status(400).send({ error: 'Visibility must be public or private' });
    }
    repository.setVisibility(name, visibility);
    return { name: skill.name, visibility };
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
    // 读矩阵与技能上下文不是敏感数据:任何对该技能有可见性的用户都能查看;变更仍走 POST 的管理权守门。
    if (!(await hasReadAccess(giteaService, skill, user.username))) {
      return reply.status(403).send({ error: 'Forbidden: no access to this private skill; request access from its maintainers' });
    }
    return buildPermissionsResponse(skill, user.username);
  });

  // 技能描述随 Source Upload 更新(CONTEXT:Skill Description):仅 Maintainer
  // 可改,直接落库,不涉及 Git Backend。
  app.put('/api/skills/:scope/:skillName/description', async (request, reply) => {
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
    if (!(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send({ error: 'Forbidden: manage permission required' });
    }
    const body = request.body as { description?: string };
    if (typeof body.description !== 'string' || !body.description.trim()) {
      return reply.status(400).send({ error: 'Skill description is required' });
    }
    repository.updateSkillDescription(name, body.description.trim());
    return { name: skill.name, description: body.description.trim() };
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
    if (!(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send({ error: 'Forbidden: manage permission required' });
    }

    const body = request.body as {
      action?: string;
      team?: string;
      team_id?: number;
      username?: string;
      permission?: string;
    };
    const repo = skillRepo(skill);
    // 路由侧做无副作用的参数与目标校验,实际的 Gitea 变更同步执行
    // (ADR-0032:Operation 机器退役);Gitea 始终是权限的事实来源。
    let payload: {
      skillName: string;
      scope: string;
      repoOwner: string;
      repoName: string;
      action: string;
      teamId?: number;
      username?: string;
      permission?: string;
    };
    switch (body.action) {
      case 'share_all_read':
      case 'share_all_write':
      case 'share_all_manage': {
        const teamName = SHARE_TIER_TEAM_NAMES[shareTierOf(body.action)];
        const team = (await giteaService.listTeams(skill.scope)).find((entry) => entry.name === teamName);
        if (!team) {
          return reply.status(404).send({ error: `Default team ${teamName} not found in organization` });
        }
        payload = { skillName: name, scope: skill.scope, repoOwner: repo.owner, repoName: repo.name, action: body.action, teamId: team.id };
        break;
      }
      case 'remove_team':
      case 'set_team': {
        const teams = await giteaService.listTeams(skill.scope);
        const teamKey = body.team ?? undefined;
        const teamById =
          typeof body.team_id === 'number'
            ? teams.find((entry) => entry.id === body.team_id && entry.name.endsWith('-read'))
            : undefined;
        const readTeam =
          teamById ??
          (teamKey ? teams.find((entry) => entry.name === teamKey || entry.name === `${teamKey}-read`) : undefined);
        const logicalName = readTeam?.name.endsWith('-read')
          ? readTeam.name.slice(0, -'-read'.length)
          : teamKey;
        if (!readTeam || !logicalName) {
          return reply.status(404).send({ error: 'Team not found in organization' });
        }
        const isProjection =
          teams.some((entry) => entry.name === backendTeamName(logicalName, 'read')) &&
          teams.some((entry) => entry.name === backendTeamName(logicalName, 'write')) &&
          teams.some((entry) => entry.name === backendTeamName(logicalName, 'manage'));
        if (!isProjection) {
          return reply.status(400).send({ error: 'Team is not a logical custom team' });
        }
        if (body.action === 'set_team' &&
            body.permission !== 'read' &&
            body.permission !== 'write' &&
            body.permission !== 'manage') {
          return reply.status(400).send({ error: 'Team permission must be read, write, or manage' });
        }
        payload = {
          skillName: name,
          scope: skill.scope,
          repoOwner: repo.owner,
          repoName: repo.name,
          action: body.action,
          teamId: readTeam.id,
          permission: body.permission,
          username: logicalName
        };
        break;
      }
      case 'add_member': {
        // ADR-0025 三档:read/write/manage;manage 档由执行器映射为 Gitea admin 级协作者。
        if (
          !body.username ||
          (body.permission !== 'read' && body.permission !== 'write' && body.permission !== 'manage')
        ) {
          return reply.status(400).send({ error: 'Username and a read, write, or manage permission are required' });
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
        payload = { skillName: name, scope: skill.scope, repoOwner: repo.owner, repoName: repo.name, action: body.action };
        break;
      }
      default:
        return reply.status(400).send({ error: 'Unknown permission action' });
    }

    // 常设团队档位互斥（原 ADR-0026 组织共享级别语义）：设置某档时卸载其余两档
    const ALL_SHARE_TEAM_NAMES = new Set(STANDING_TEAM_NAMES);
    try {
      switch (payload.action) {
        case 'share_all_read':
        case 'share_all_write':
        case 'share_all_manage': {
          await giteaService.addTeamRepo(payload.teamId!, repo.owner, repo.name);
          const mountName = SHARE_TIER_TEAM_NAMES[shareTierOf(payload.action)];
          for (const team of await giteaService.listRepoTeams(repo.owner, repo.name)) {
            if (team.name !== mountName && ALL_SHARE_TEAM_NAMES.has(team.name)) {
              await giteaService.removeTeamRepo(team.id, repo.owner, repo.name);
            }
          }
          break;
        }
        case 'set_team': {
          const teams = await giteaService.listTeams(skill.scope);
          const logicalName = payload.username!;
          const projection = {
            read: teams.find((team) => team.name === backendTeamName(logicalName, 'read')),
            write: teams.find((team) => team.name === backendTeamName(logicalName, 'write')),
            manage: teams.find((team) => team.name === backendTeamName(logicalName, 'manage'))
          };
          for (const team of Object.values(projection)) {
            if (team) await giteaService.removeTeamRepo(team.id, repo.owner, repo.name);
          }
          const permission = payload.permission as 'read' | 'write' | 'manage';
          const selected = projection[permission];
          if (!selected) return reply.status(409).send({ error: 'Logical team projection is incomplete' });
          await giteaService.addTeamRepo(selected.id, repo.owner, repo.name);
          skillTeamGrantRepository.set(payload.skillName, payload.teamId!, permission);
          break;
        }
        case 'remove_team': {
          const teams = await giteaService.listTeams(skill.scope);
          const logicalName = payload.username!;
          for (const permission of ['read', 'write', 'manage'] as const) {
            const team = teams.find((entry) => entry.name === backendTeamName(logicalName, permission));
            if (team) await giteaService.removeTeamRepo(team.id, repo.owner, repo.name);
          }
          skillTeamGrantRepository.remove(payload.skillName, payload.teamId!);
          break;
        }
        case 'add_member':
          await giteaService.addCollaborator(
            repo.owner,
            repo.name,
            payload.username!,
            payload.permission === 'manage' ? 'admin' : (payload.permission as 'read' | 'write')
          );
          break;
        case 'remove_member':
          await giteaService.removeCollaborator(repo.owner, repo.name, payload.username!);
          break;
        case 'reset_to_private': {
          for (const team of await giteaService.listRepoTeams(repo.owner, repo.name)) {
            await giteaService.removeTeamRepo(team.id, repo.owner, repo.name);
          }
          if (typeof giteaService.listCollaborators === 'function') {
            for (const member of await giteaService.listCollaborators(repo.owner, repo.name)) {
              if (member.username === skill.owner) continue;
              await giteaService.removeCollaborator(repo.owner, repo.name, member.username);
            }
          }
          skillTeamGrantRepository.clearAllForSkill?.(payload.skillName);
          break;
        }
        default:
          return reply.status(400).send({ error: 'Unknown permission action' });
      }
    } catch (error) {
      return reply.status(409).send({
        error: (error as Error).message ?? 'Permission change failed',
        retryable: true
      });
    }
    return buildPermissionsResponse(skill, user.username);
  });

  app.post('/api/skills/:scope/:skillName/rename', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string };
    const currentName = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(currentName);
    const nextShortName = (request.body as { name?: string }).name ?? '';
    if (!user || !skill || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send({ error: 'Forbidden: manage permission required' });
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
    if (!user || !skill || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send({ error: 'Forbidden: manage permission required' });
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
    // ADR-0032:publish 只断言归属——release.json 的 name 必须与技能既定身份
    // 一致(裸名按发布者个人命名空间补全),不一致即拒绝,归属变更不得借发布顺车。
    const manifestIdentity = parseSkillIdentity(manifest.data.name);
    const manifestScope = manifestIdentity?.scope ?? user.username;
    if (
      !manifestIdentity ||
      `@${manifestScope}/${manifestIdentity.shortName}` !== skill.name
    ) {
      return reply.status(409).send({
        error: `Release manifest name "${manifest.data.name}" does not match the established identity ${skill.name}; ownership changes are not allowed via publish`
      });
    }
    if (!skill.skillId) {
      return reply.status(409).send({ error: 'Skill has no Skill ID' });
    }
    // Tombstones included on purpose: deleting a release burns its version number.
    if (repository.getRelease(name, body.version, { includeDeleted: true })) {
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
    // The install manifest is generated, so its version is the Skill Release
    // version — it must win over the Release Manifest's `version` field, which
    // describes the source rather than the release.
    publishedFiles['skill.json'] = `${JSON.stringify({
      ...manifest.data,
      name,
      version: body.version,
      skillId: skill.skillId,
      sourceCommit: body.sourceCommit,
      contentChecksum
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
    if (!user || !skill || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send({ error: 'Forbidden: manage permission required' });
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
      return reply.status(403).send({ error: 'Forbidden: no access to this private skill; request access from its maintainers' });
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
    if (!user || !skill || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send({ error: 'Forbidden: manage permission required' });
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

  // 单版本删除(CONTEXT:单版本删除):外科手术式移除一个 Skill Release,保留
  // 源码 Git 历史、技能本身与其余版本。Maintainer 可执行,但被其他技能的
  // Release Dependency Lock 引用时须由平台管理员强制。版本号烧毁不可重发。
  app.post('/api/skills/:scope/:skillName/releases/:version/delete', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string; version: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const version = decodeURIComponent(params.version);
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(name);
    if (!user || !skill || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send({ error: 'Forbidden: manage permission required' });
    }
    const body = (request.body ?? {}) as { confirm?: string; force?: boolean };
    if (body.confirm !== version) {
      return reply.status(400).send({ error: 'Deletion requires confirm matching the release version' });
    }
    const release = repository.getRelease(name, version);
    if (!release || !skill.skillId) {
      return reply.status(404).send({ error: 'Skill Release not found' });
    }
    const dependents = repository.findDependentReleases(skill.skillId, version);
    if (dependents.length > 0) {
      if (!body.force) {
        return reply.status(409).send({
          error: `Release ${version} is required by ${dependents.join(', ')}; deleting it would break their installs. Pass force to override.`
        });
      }
      if (!(await authorizePlatformAdministrator(request, adminRepository, giteaService))) {
        return reply.status(403).send({
          error: 'Forbidden: forcing past a pinned dependency requires a platform administrator'
        });
      }
    }
    // Git tag first: an orphaned tag is harmless, a release without its tag is not.
    if (typeof giteaService.deleteReleaseTag === 'function') {
      try {
        const repo = skillRepo(skill);
        await giteaService.deleteReleaseTag(repo.owner, repo.name, `v${version}`);
      } catch {
        // Best-effort: the tag can be repaired later; the release still goes.
      }
    }
    await fs.rm(release.packagePath, { force: true });
    repository.deleteRelease(name, version, user.username);
    repository.removeVersion(name, version);
    return reply.send({ deleted: true, name, version, dependents });
  });

  // 弃用标记(npm deprecate 的对应物):不可变发布模型下,坏版本无法删除,只能
  // 保留可追溯性并对消费者给出劝退信号。空 message 解除标记。不改变版本解析。
  app.post('/api/skills/:scope/:skillName/releases/:version/deprecate', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string; version: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(name);
    if (!user || !skill || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send({ error: 'Forbidden: manage permission required' });
    }
    if (skill.status === 'archived') {
      return reply.status(409).send({ error: 'Archived skills do not accept release changes' });
    }
    const body = request.body as { message?: string };
    if (body.message !== undefined && typeof body.message !== 'string') {
      return reply.status(400).send({ error: 'Deprecation message must be a string' });
    }
    const updated = repository.setReleaseDeprecation(
      name,
      decodeURIComponent(params.version),
      body.message ?? ''
    );
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
    if (!user || !skill || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send({ error: 'Forbidden: manage permission required' });
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
      return reply.status(403).send({ error: 'Forbidden: no access to this private skill; request access from its maintainers' });
    }

    const releases = repository.getReleases(name);
    const latest = newestStableRelease(releases);
    return withCloneUrl(request, {
      ...skill,
      versions: sortVersionsDescending(repository.getVersions(name)),
      releases: releases.map((release) => ({
        ...release,
        deprecatedMessage: release.deprecatedMessage ?? null,
        packageUrl: `${requestOrigin(request)}/api/packages/${release.skillId}/${release.version}/${path.basename(release.packagePath)}`
      })),
      packageUrl: latest
        ? `${requestOrigin(request)}/api/packages/${latest.skillId}/${latest.version}/${path.basename(latest.packagePath)}`
        : undefined
    });
  });
}

// share_all_* 动作 → 授权档位（落点为对应的常设团队）
function shareTierOf(action: string): 'read' | 'write' | 'manage' {
  return action === 'share_all_read' ? 'read' : action === 'share_all_write' ? 'write' : 'manage';
}

function newestStableRelease<T extends { version: string }>(
  releases: readonly T[]
): T | undefined {
  const version = highestStableVersion(releases.map((release) => release.version));
  return version ? releases.find((release) => release.version === version) : undefined;
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
    const selectedVersion = highestSatisfyingVersion(
      releases.map((release) => release.version),
      range
    );
    const selected = selectedVersion
      ? releases.find((release) => release.version === selectedVersion)
      : undefined;
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

// ADR-0025 三档权限:Read/Write/Manage,Manage 档隐含读与写。
// 判定顺序:先看 DB 记录与角色约定(owner/初始 Maintainer/所有者成员/超管,
// 无网络往返),再查 Git Backend 的团队与协作者授权(Gitea 是权限事实来源)。
export type SkillAccessLevel = 'none' | 'read' | 'write' | 'manage';

async function getAccessLevel(
  giteaService: GiteaService,
  skill: SkillRecord,
  username: string | undefined
): Promise<SkillAccessLevel> {
  if (!username) return 'none';
  // DB 记录的 owner 与初始 Maintainer(创建者)天然持有管理权(ADR-0025:
  // maintainers_json 退化为初始创建者记录);超级管理员同理。
  if (username === skill.owner || skill.maintainers.includes(username)) return 'manage';
  if (giteaService.adminUsername && username === giteaService.adminUsername) return 'manage';
  // 组织管理团队治理兜底（ADR-0033）：Owners 团队成员可见并管理
  // 本组织名下全部技能；个人技能的 scope 即所有者本人，已在上面命中。
  if (skill.scope !== username && (await isOrgSkillManager(giteaService, skill.scope, username))) {
    return 'manage';
  }
  // public 是 Read 基线而不是权限上限：继续合并团队与个人授权，使 write/manage
  // 来源能够提升最终权限。仓库缺失或查询失败时仍保留 public 的可读兜底。
  const publicRead = skill.visibility === 'public';
  const hasPermissionSupport =
    typeof giteaService.listRepoTeams === 'function' || typeof giteaService.isCollaborator === 'function';
  if (!hasPermissionSupport) {
    // Git backends without permission APIs cannot be filtered; keep legacy behavior.
    return 'read';
  }
  const repo = skillRepo(skill);
  let level: SkillAccessLevel = publicRead ? 'read' : 'none';
  try {
    if (typeof giteaService.listRepoTeams === 'function' && typeof giteaService.isTeamMember === 'function') {
      for (const team of await giteaService.listRepoTeams(repo.owner, repo.name)) {
        if (!(await giteaService.isTeamMember(team.id, username))) continue;
        if (team.permission === 'admin' || team.permission === 'owner') return 'manage';
        if (team.permission === 'write') level = 'write';
        else if (level === 'none') level = 'read';
      }
    }
    if (typeof giteaService.getCollaboratorPermission === 'function') {
      const permission = await giteaService.getCollaboratorPermission(repo.owner, repo.name, username);
      if (permission === 'admin' || permission === 'owner') return 'manage';
      if (permission === 'write') level = 'write';
      else if (permission === 'read' && level === 'none') level = 'read';
    }
  } catch (error) {
    if (publicRead) return level;
    throw error;
  }
  return level;
}

// 组织级技能管理权（ADR-0038）：所有者成员或 org-managers 成员。scope 不是组织
// （个人技能）时按无组织级权限处理，判定统一走共享实现。
async function isOrgSkillManager(giteaService: GiteaService, org: string, username: string): Promise<boolean> {
  return (await isOwnerMemberOf(giteaService, org, username)) ||
    (await isManagingMemberOf(giteaService, org, username));
}

async function hasReadAccess(
  giteaService: GiteaService,
  skill: SkillRecord,
  username: string | undefined
): Promise<boolean> {
  return (await getAccessLevel(giteaService, skill, username)) !== 'none';
}

// 管理权判定(ADR-0025):publish、rename、archive、权限配置等技能管理操作统一守门。
async function canManageSkill(
  giteaService: GiteaService,
  skill: SkillRecord,
  username: string | undefined
): Promise<boolean> {
  return (await getAccessLevel(giteaService, skill, username)) === 'manage';
}

// ESL 三档权限词汇(ADR-0025):Gitea 的 admin/owner 仓库访问级别统一呈现为
// manage,与授权操作的档位词汇保持一致。
function normalizePermission(permission: string): string {
  return permission === 'admin' || permission === 'owner' ? 'manage' : permission;
}

function projectionPermission(teamName: string): 'read' | 'write' | 'manage' | undefined {
  if (teamName.endsWith('-read')) return 'read';
  if (teamName.endsWith('-write')) return 'write';
  if (teamName.endsWith('-manage')) return 'manage';
  return undefined;
}

function buildLogicalTeamViews(
  repoTeams: GiteaTeam[],
  orgTeams: GiteaTeam[],
  grants: Array<{ teamId: number; permission: 'read' | 'write' | 'manage' }>,
  tenantOrganizationRepository: TenantOrganizationRepository,
  scope: string
): Array<{ id: number; name: string; display_name?: string; permission: string }> {
  const views = new Map<number, { id: number; name: string; display_name?: string; permission: string }>();
  for (const mounted of repoTeams) {
    const mountedPermission = projectionPermission(mounted.name);
    if (!mountedPermission) continue;
    const logicalName = mounted.name.slice(0, -`-${mountedPermission}`.length);
    const projection = {
      read: orgTeams.find((team) => team.name === backendTeamName(logicalName, 'read')),
      write: orgTeams.find((team) => team.name === backendTeamName(logicalName, 'write')),
      manage: orgTeams.find((team) => team.name === backendTeamName(logicalName, 'manage'))
    };
    if (!projection.read || !projection.write || !projection.manage) continue;
    const readTeam = projection.read;
    const grant = grants.find((entry) => entry.teamId === readTeam.id);
    views.set(readTeam.id, {
      id: readTeam.id,
      name: logicalName,
      display_name: tenantOrganizationRepository.getTeamDisplayName(scope, readTeam.id),
      permission: grant?.permission ?? mountedPermission
    });
  }
  return [...views.values()];
}

async function getPermissionMatrix(
  giteaService: GiteaService,
  tenantOrganizationRepository: TenantOrganizationRepository,
  skillTeamGrantRepository: SkillTeamGrantRepository,
  skill: SkillRecord
) {
  const repo = skillRepo(skill);
  const repoTeams =
    typeof giteaService.listRepoTeams === 'function'
      ? await giteaService.listRepoTeams(repo.owner, repo.name)
      : [];
  let orgTeams: GiteaTeam[] = [];
  try {
    orgTeams = await giteaService.listTeams(skill.scope);
  } catch {
    // 个人技能没有组织团队；权限矩阵只保留共享状态与个人协作者。
  }
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
    memberViews.push({ username: member.username, permission: normalizePermission(permission) });
  }
  return {
    scope: skill.scope,
    skillName: skill.skillName,
    sharedAllRead: repoTeams.some((team) => team.name === 'all-readers'),
    sharedAllWrite: repoTeams.some((team) => team.name === 'all-writers'),
    // ADR-0026:组织共享级别三档,all-managers 对应"全员可管理"
    sharedAllManage: repoTeams.some((team) => team.name === 'all-managers'),
    // 团队授权下拉仅列自定义团队:默认团队由共享级别承载,Owners 与
    // system-admins 的权限是结构性的,逐技能授予无意义(ADR-0026)。
    teams: buildLogicalTeamViews(
      repoTeams,
      orgTeams,
      skillTeamGrantRepository.list(skill.name),
      tenantOrganizationRepository,
      skill.scope
    ),
    members: memberViews
  };
}

// 技能管理页面的只读上下文块(CONTEXT:技能管理页面):描述、发布状态与完整
// Skill Release 列表。latestRelease 取最高稳定版本,与 CLI 的默认解析一致。
function buildSkillContext(repository: SkillRepository, skill: SkillRecord) {
  const releases = repository.getReleases(skill.name);
  const latest = newestStableRelease(releases);
  const releaseViews = releases.map((release) => ({
    version: release.version,
    createdAt: release.createdAt,
    notes: release.notes,
    deprecatedMessage: release.deprecatedMessage ?? null,
    sourceCommit: release.sourceCommit,
    createdBy: release.createdBy
  }));
  return {
    name: skill.name,
    description: skill.description,
    status: skill.status,
    createdBy: skill.createdBy,
    latestRelease: latest
      ? { version: latest.version, createdAt: latest.createdAt, notes: latest.notes }
      : undefined,
    releases: releaseViews
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
