import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isStandingTeam, validateMemberUsername, type OrgIdentity } from '@esl/core';
import type {
  OrgInvitationRepository,
  PlatformSettingsRepository,
  SkillRepository,
  SkillTeamGrantRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import { performOrganizationDeletion } from '../services/org-delete.js';
import {
  addMemberToAutoJoinTeams,
  applyOrgIdentity,
  checkOwnerMemberInvariant,
  isManagingMemberOf,
  isOwnerMemberOf,
  listOrgMembersWithIdentity,
  removeMemberFromOrganization
} from '../services/organization-membership.js';
import { DEFAULT_TEAM_DISPLAY_NAMES } from '../services/org-team-model.js';
import {
  backendTeamName,
  deleteLogicalTeamProjection,
  ensureLogicalTeamProjection,
  type LogicalTeamProjection,
  syncLogicalTeamMembers
} from '../services/logical-team-projection.js';

export interface OrgConsoleRouteOptions {
  giteaService: GiteaService;
  repository: SkillRepository;
  platformSettingsRepository: PlatformSettingsRepository;
  orgInvitationRepository: OrgInvitationRepository;
  tenantOrganizationRepository: TenantOrganizationRepository;
  skillTeamGrantRepository: SkillTeamGrantRepository;
}

// 团队显示名(ADR-0029):ESL 侧可选展示字段,允许中文,最长 64 字符。
const TEAM_DISPLAY_NAME_MAX = 64;

// 不可删除/改名的团队 = 四个命名常设团队 ∪ Owners（组织管理团队，ADR-0038）。
// 它们同时不受通用团队成员接口管辖：那是身份，不是团队授权。
function isProtectedTeam(team: { name: string; permission: string }): boolean {
  return team.permission === 'owner' || isStandingTeam(team.name);
}

// 受保护团队的成员增删会改变一个人的组织内身份，必须走成员列表的一等动作。
const IDENTITY_NOT_A_TEAM_GRANT =
  'This team carries an organization identity, not a skill grant; change the member identity instead';

export function registerOrgConsoleRoutes(app: FastifyInstance, options: OrgConsoleRouteOptions): void {
  const {
    giteaService,
    repository,
    platformSettingsRepository,
    orgInvitationRepository,
    tenantOrganizationRepository,
    skillTeamGrantRepository
  } =
    options;

  async function logicalProjectionForTeam(org: string, teamId: number): Promise<LogicalTeamProjection | undefined> {
    const teams = await giteaService.listTeams(org);
    const readTeam = teams.find((team) => team.id === teamId && team.name.endsWith('-read'));
    if (!readTeam) return undefined;
    const teamKey = readTeam.name.slice(0, -'-read'.length);
    const projection = {} as LogicalTeamProjection;
    for (const permission of ['read', 'write', 'manage'] as const) {
      const team = teams.find((candidate) => candidate.name === backendTeamName(teamKey, permission));
      if (!team) return undefined;
      projection[permission] = team;
    }
    return projection;
  }

  app.get('/api/orgs/:orgName/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository, {
      allowManaging: true
    });
    if (!org) return;
    return listOrgMembersWithIdentity(giteaService, org);
  });

  // 身份变更（ADR-0038）：提升 / 收回，是成员列表上的一等动作，只有所有者成员能做。
  // 三档嵌套由 applyOrgIdentity 落实；"不能让组织失去全部所有者成员"是唯一不变量。
  app.put('/api/orgs/:orgName/members/:username/identity', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    const { identity } = (request.body ?? {}) as { identity?: string };
    if (identity !== 'ordinary' && identity !== 'managing' && identity !== 'owner') {
      return reply.status(400).send({ error: 'Identity must be ordinary, managing, or owner' });
    }
    // 身份变更只作用于**已在组织里**的人；把组织外的人拉进来是「添加成员」或
    // 平台超管的空降路径（/api/admin/...），不走这里。
    if (!(await giteaService.listOrgMembers(org)).some((member) => member.username === username)) {
      return reply.status(404).send({ error: `User is not a member of ${org}` });
    }
    const blocked = await checkOwnerMemberInvariant(giteaService, org, username, identity);
    if (blocked) {
      return reply.status(400).send({ error: blocked });
    }
    await applyOrgIdentity(giteaService, org, username, identity);
    return { username, identity };
  });

  // 直接添加：把已注册的全局账号拉进组织，自动加入三个技能授权团队（ADR-0038）。
  app.post('/api/orgs/:orgName/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository, {
      allowManaging: true
    });
    if (!org) return;
    const { username = '' } = request.body as { username?: string };
    const usernameValidation = validateMemberUsername(username);
    if (!usernameValidation.success) {
      return reply.status(400).send({ error: usernameValidation.errors.join(', ') });
    }
    // 全局账号必须已存在：所有者成员只授予组织身份，不创建账号。
    const user = await giteaService.getUser(username);
    if (!user) {
      return reply.status(404).send({ error: `User does not exist: ${username}` });
    }
    if ((await giteaService.listOrgMembers(org)).some((member) => member.username === username)) {
      return reply.status(409).send({ error: `User is already a member of ${org}` });
    }

    const mode = platformSettingsRepository.getSetting('member_add_mode') ?? 'direct';
    if (mode === 'invite') {
      const inviter = await currentUsername(giteaService, request);
      const invitation = orgInvitationRepository.create(org, username, inviter ?? user.username);
      return reply.status(202).send({
        status: 'invited',
        username,
        invitationId: invitation.id
      });
    }

    await addMemberToAutoJoinTeams(giteaService, org, username);
    return reply.status(201).send({ status: 'added', username });
  });

  // 移出成员，同时也是**自我退出**（username 就是调用者自己）：两者是同一次
  // 组织隶属关系的终止，自动从全部团队移出并退出组织。唯一约束是"不能让组织
  // 失去全部所有者成员"——自我降级、自我退出、被他人移出走同一条规则（ADR-0038）。
  app.delete('/api/orgs/:orgName/members/:username', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository, {
      allowManaging: true
    });
    if (!org) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    const actor = await currentUsername(giteaService, request);
    if (!actor) {
      return reply.status(401).send({ error: 'Unauthorized: invalid token' });
    }
    if (actor !== username && !(await isOwnerMemberOf(giteaService, org, actor))) {
      return reply.status(403).send({ error: 'Forbidden: managing members can only remove themselves' });
    }
    if (!(await giteaService.listOrgMembers(org)).some((member) => member.username === username)) {
      return reply.status(404).send({ error: `User is not a member of ${org}` });
    }
    const blocked = await checkOwnerMemberInvariant(giteaService, org, username, null);
    if (blocked) {
      return reply.status(400).send({ error: blocked });
    }
    await removeMemberFromOrganization(giteaService, org, username);
    return { removed: true, username };
  });

  // 被邀请人视角：我的待处理邀请。
  app.get('/api/orgs/invitations', async (request, reply) => {
    const username = await currentUsername(giteaService, request);
    if (!username) {
      return reply.status(401).send({ error: 'Unauthorized: invalid token' });
    }
    return orgInvitationRepository.listForUser(username);
  });

  // 被邀请人接受邀请：加入组织并自动进入三个技能授权团队（ADR-0038）。
  app.post('/api/orgs/invitations/:id/accept', async (request, reply) => {
    const username = await currentUsername(giteaService, request);
    if (!username) {
      return reply.status(401).send({ error: 'Unauthorized: invalid token' });
    }
    const id = Number((request.params as { id: string }).id);
    const invitation = orgInvitationRepository.getById(id);
    if (!invitation || invitation.username !== username) {
      return reply.status(404).send({ error: 'Invitation not found' });
    }
    if (invitation.status !== 'pending') {
      return reply.status(409).send({ error: 'Invitation has already been processed' });
    }
    await addMemberToAutoJoinTeams(giteaService, invitation.orgName, username);
    orgInvitationRepository.updateStatusById(id, 'accepted');
    return { status: 'accepted', orgName: invitation.orgName };
  });

  app.post('/api/orgs/invitations/:id/decline', async (request, reply) => {
    const username = await currentUsername(giteaService, request);
    if (!username) {
      return reply.status(401).send({ error: 'Unauthorized: invalid token' });
    }
    const id = Number((request.params as { id: string }).id);
    const invitation = orgInvitationRepository.getById(id);
    if (!invitation || invitation.username !== username) {
      return reply.status(404).send({ error: 'Invitation not found' });
    }
    if (invitation.status !== 'pending') {
      return reply.status(409).send({ error: 'Invitation has already been processed' });
    }
    orgInvitationRepository.updateStatusById(id, 'declined');
    return { status: 'declined', orgName: invitation.orgName };
  });

  app.get('/api/orgs/:orgName/invitations', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    return orgInvitationRepository.listByOrg(org);
  });

  // 撤销邀请（ADR-0032 邀请制的发起方半边）：所有者成员可撤回本组织已发出
  // 的待处理邀请——被邀请人还没回应时，邀请不该是不可收回的。已接受/已拒绝/
  // 已撤销的邀请不能再撤销。
  app.delete('/api/orgs/:orgName/invitations/:id', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const id = Number((request.params as { id: string }).id);
    const invitation = orgInvitationRepository.getById(id);
    if (!invitation || invitation.orgName !== org) {
      return reply.status(404).send({ error: 'Invitation not found' });
    }
    if (invitation.status !== 'pending') {
      return reply.status(409).send({ error: 'Invitation has already been processed' });
    }
    orgInvitationRepository.updateStatusById(id, 'revoked');
    return { status: 'revoked', orgName: org, username: invitation.username, invitationId: id };
  });

  app.get('/api/orgs/:orgName/teams', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository, {
      allowManaging: true
    });
    if (!org) return;
    // ADR-0025:对外统一 ESL 三档词汇,Gitea 的 admin 级团队呈现为 manage。
    // ADR-0032:Owners 与四个常设团队是授权载体,不属于可管理的自定义团队,
    // 不出现在团队管理界面。显示名读时惰性播种(ADR-0029)。
    const teams = await giteaService.listTeams(org);
    const teamNames = new Set(teams.map((team) => team.name));
    return teams
      .filter((team) => team.name.endsWith('-read'))
      .filter((team) => {
        const key = team.name.slice(0, -'-read'.length);
        return ['write', 'manage'].every((permission) =>
          teamNames.has(backendTeamName(key, permission as 'write' | 'manage'))
        );
      })
      .map((team) => ({
        id: team.id,
        name: team.name.slice(0, -'-read'.length),
        display_name: tenantOrganizationRepository.getTeamDisplayName(org, team.id)
      }));
  });

  app.post('/api/orgs/:orgName/teams', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository, {
      allowManaging: true
    });
    if (!org) return;
    const body = request.body as { name?: string; display_name?: unknown; permission?: unknown };
    const { name = '' } = body;
    if (!/^[a-z0-9-]{1,64}$/.test(name)) {
      return reply.status(400).send({ error: 'Team name must use lowercase letters, digits, and hyphens' });
    }
    if (isStandingTeam(name) || name === 'Owners') {
      return reply.status(400).send({ error: 'Team name is reserved for standing teams' });
    }
    if (body.permission !== undefined) {
      return reply.status(400).send({ error: 'Custom teams do not have a fixed permission' });
    }
    const displayName = normalizeTeamDisplayName(body.display_name);
    if (displayName !== null && displayName !== undefined && displayName.length > TEAM_DISPLAY_NAME_MAX) {
      return reply.status(400).send({ error: 'Team display name must be at most 64 characters' });
    }
    const projection = await ensureLogicalTeamProjection(giteaService, org, name, []);
    // ADR-0029:显示名是 ESL 侧数据,创建成功后落库;空显示名视为未设置。
    if (displayName) {
      tenantOrganizationRepository.setTeamDisplayName(org, projection.read.id, displayName);
    }
    return reply.status(201).send({
      id: projection.read.id,
      name,
      display_name: displayName ?? undefined
    });
  });

  app.delete('/api/orgs/:orgName/teams/:teamId', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository, {
      allowManaging: true
    });
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const team = (await giteaService.listTeams(org)).find((entry) => entry.id === teamId);
    if (!team) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    const projection = await logicalProjectionForTeam(org, teamId);
    if (!projection) {
      return reply.status(400).send({ error: 'Standing teams cannot be deleted' });
    }
    for (const grant of skillTeamGrantRepository.listByTeam(teamId)) {
      const skill = repository.getSkill(grant.skillName);
      if (!skill) continue;
      const slash = skill.gitRepoPath.indexOf('/');
      const repoOwner = skill.gitRepoPath.slice(0, slash);
      const repoName = skill.gitRepoPath.slice(slash + 1);
      await giteaService.removeTeamRepo(projection[grant.permission].id, repoOwner, repoName);
    }
    skillTeamGrantRepository.removeByTeam(teamId);
    await deleteLogicalTeamProjection(giteaService, projection);
    tenantOrganizationRepository.deleteTeamProfile(org, teamId);
    return { deleted: true };
  });

  // 自定义逻辑团队编辑只允许修改标识名和显示名；技能权限属于单个技能。
  app.patch('/api/orgs/:orgName/teams/:teamId', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository, {
      allowManaging: true
    });
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const team = (await giteaService.listTeams(org)).find((entry) => entry.id === teamId);
    if (!team) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    const projection = await logicalProjectionForTeam(org, teamId);
    if (!projection) {
      return reply.status(400).send({ error: 'Standing teams cannot be edited' });
    }
    const body = request.body as { name?: string; permission?: unknown; display_name?: unknown };
    if (body.name !== undefined && !/^[a-z0-9-]{1,64}$/.test(body.name)) {
      return reply.status(400).send({ error: 'Team name must use lowercase letters, digits, and hyphens' });
    }
    if (body.name !== undefined && (isStandingTeam(body.name) || body.name === 'Owners')) {
      return reply.status(400).send({ error: 'Team name is reserved for standing teams' });
    }
    if (body.permission !== undefined) {
      return reply.status(400).send({ error: 'Custom teams do not have a fixed permission' });
    }
    // 显示名:字段存在即覆盖(空串/空 → 清空),不存在则保持。
    let displayNameChange: string | null | undefined;
    if (body.display_name !== undefined) {
      displayNameChange = normalizeTeamDisplayName(body.display_name);
      if (displayNameChange != null && displayNameChange.length > TEAM_DISPLAY_NAME_MAX) {
        return reply.status(400).send({ error: 'Team display name must be at most 64 characters' });
      }
    }
    const currentKey = team.name.slice(0, -'-read'.length);
    if (body.name !== undefined && body.name !== currentKey) {
      for (const permission of ['read', 'write', 'manage'] as const) {
        await giteaService.updateTeam(projection[permission].id, {
          name: backendTeamName(body.name, permission)
        });
      }
    }
    if (displayNameChange !== undefined) {
      tenantOrganizationRepository.setTeamDisplayName(org, teamId, displayNameChange);
    }
    const displayName =
      displayNameChange ?? tenantOrganizationRepository.getTeamDisplayName(org, teamId);
    return {
      id: projection.read.id,
      name: body.name ?? currentKey,
      display_name: displayName ?? undefined
    };
  });

  app.get('/api/orgs/:orgName/teams/:teamId/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository, {
      allowManaging: true
    });
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    if (!(await orgHasTeam(giteaService, org, teamId))) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    const projection = await logicalProjectionForTeam(org, teamId);
    if (!projection) return reply.status(400).send({ error: 'Standing teams cannot be used here' });
    return giteaService.listTeamMembers(projection.read.id);
  });

  // ADR-0029:该逻辑团队已授权的技能数(= 三个内部权限团队挂载仓库中属于
  // 本组织技能仓库的去重数量)。
  // gitRepoPath 与 Gitea repo full_name 同为 "{owner}/{name}",直接匹配。
  app.get('/api/orgs/:orgName/teams/:teamId/skills-count', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository, {
      allowManaging: true
    });
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    if (!(await orgHasTeam(giteaService, org, teamId))) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    const skillRepoKeys = new Set(
      repository
        .listSkills()
        .filter((skill) => skill.scope === org)
        .map((skill) => skill.gitRepoPath)
    );
    const projection = await logicalProjectionForTeam(org, teamId);
    if (!projection) return reply.status(400).send({ error: 'Standing teams cannot be used here' });
    const mountedRepos = new Set<string>();
    for (const team of Object.values(projection)) {
      for (const repo of await giteaService.listTeamRepos(team.id)) {
        if (skillRepoKeys.has(repo.full_name)) mountedRepos.add(repo.full_name);
      }
    }
    const skillsCount = mountedRepos.size;
    return { teamId, skillsCount };
  });

  // 团队成员授权:逐团队添加/移除成员(ADR-0032 权限矩阵的团队载体)。**只对自定义
  // 团队成立**——受保护团队（Owners 与四个常设团队）的成员增删是身份变更，见
  // /members/:username/identity。留着这条暗门，身份变更就有第二个入口，"至少保留
  // 一名所有者成员"与超管兜底都能被绕过去（ADR-0038）。
  app.post('/api/orgs/:orgName/teams/:teamId/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository, {
      allowManaging: true
    });
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const { username = '' } = request.body as { username?: string };
    const usernameValidation = validateMemberUsername(username);
    if (!usernameValidation.success) {
      return reply.status(400).send({ error: usernameValidation.errors.join(', ') });
    }
    const team = (await giteaService.listTeams(org)).find((entry) => entry.id === teamId);
    if (!team) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    if (isProtectedTeam(team)) {
      return reply.status(400).send({ error: IDENTITY_NOT_A_TEAM_GRANT });
    }
    // 授权对象必须是已注册的全局账号（与拉人路径同一前置校验）
    if (!(await giteaService.getUser(username))) {
      return reply.status(404).send({ error: `User does not exist: ${username}` });
    }
    const projection = await logicalProjectionForTeam(org, teamId);
    if (!projection) return reply.status(400).send({ error: 'Standing teams cannot be used here' });
    await syncLogicalTeamMembers(giteaService, projection, [
      ...new Set([
        ...(await giteaService.listTeamMembers(projection.read.id)).map((member) => member.username),
        username
      ])
    ]);
    return reply.status(201).send({ teamId, username });
  });

  app.delete('/api/orgs/:orgName/teams/:teamId/members/:username', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository, {
      allowManaging: true
    });
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const username = decodeURIComponent((request.params as { username: string }).username);
    const team = (await giteaService.listTeams(org)).find((entry) => entry.id === teamId);
    if (!team) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    if (isProtectedTeam(team)) {
      return reply.status(400).send({ error: IDENTITY_NOT_A_TEAM_GRANT });
    }
    const projection = await logicalProjectionForTeam(org, teamId);
    if (!projection) return reply.status(400).send({ error: 'Standing teams cannot be used here' });
    const members = (await giteaService.listTeamMembers(projection.read.id))
      .map((member) => member.username)
      .filter((member) => member !== username);
    await syncLogicalTeamMembers(giteaService, projection, members);
    return { teamId, username, removed: true };
  });

  // 组织删除（ADR-0034）：所有者成员即可发起，手打组织名确认；沿用
  // Organization Deletion State（deleting → 完成 / delete_failed）。删除失败必须
  // 可由治理者重试，因此这条路由对非 active 的组织放行——其余组织管理操作仍被拦。
  // 平台管理员的同款能力见 /api/admin/orgs/:orgName（治理兜底）。
  app.delete('/api/orgs/:orgName', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository, {
      allowNonActive: true
    });
    if (!org) return;
    const { confirm } = (request.body ?? {}) as { confirm?: string };
    if (confirm !== org) {
      return reply.status(400).send({ error: 'Deletion requires confirm matching the organization name' });
    }
    // 只有 ESL 开通的组织才允许自动删除（与超管路径同一守门），防止误删
    // 直接在 Git Backend 建出来的外部组织。
    if (!tenantOrganizationRepository.get(org)) {
      return reply.status(404).send({ error: 'Organization not found or not managed by ESL' });
    }
    try {
      await performOrganizationDeletion(
        { giteaService, skillRepository: repository, tenantOrganizationRepository },
        org
      );
    } catch (error) {
      // 失败原因已由删除流程写入租户状态（delete_failed + lastError）
      return reply
        .status(409)
        .send({ error: `Organization deletion failed: ${(error as Error).message}`, retryable: true });
    }
    return { status: 'deleted', orgName: org };
  });
}

async function orgHasTeam(giteaService: GiteaService, org: string, teamId: number): Promise<boolean> {
  return (await giteaService.listTeams(org)).some((team) => team.id === teamId);
}

// 显示名归一化(ADR-0029):未提供 → undefined(不处理);null/空串 → null(清空);
// 提供则去空格。显示名允许中文,不受标识名 ASCII 约束。
function normalizeTeamDisplayName(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length === 0 ? null : trimmed;
}

// 全局身份（ADR-0032）：组织从 URL 的 :orgName 提供，治理者 = Owners 团队成员。
async function requireOrgAdministrator(
  request: FastifyRequest,
  reply: FastifyReply,
  giteaService: GiteaService,
  tenantOrganizationRepository: TenantOrganizationRepository,
  // 组织删除需要在 deleting / delete_failed 状态下仍可发起（重试），是唯一例外。
  // allowManaging 仅用于管理成员可执行的运营端点，不适用于身份与清退治理。
  options: { allowNonActive?: boolean; allowManaging?: boolean } = {}
): Promise<string | null> {
  const orgName = decodeURIComponent((request.params as { orgName: string }).orgName);
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) {
    reply.status(401).send({ error: 'Unauthorized: missing token' });
    return null;
  }
  const token = authorization.replace('token ', '').trim();
  const user = await giteaService.validateToken(token);
  if (!user) {
    reply.status(403).send({ error: 'Forbidden: organization management team membership required' });
    return null;
  }
  if (!(await giteaService.organizationExists(orgName))) {
    reply.status(403).send({ error: 'Forbidden: organization management team membership required' });
    return null;
  }
  const isOwner = await isOwnerMemberOf(giteaService, orgName, user.username);
  const isOperator = options.allowManaging && (await isManagingMemberOf(giteaService, orgName, user.username));
  if (!isOwner && !isOperator) {
    reply.status(403).send({ error: 'Forbidden: organization management team membership required' });
    return null;
  }
  // 处理中的组织(删除中、删除失败)禁止一切组织管理操作。
  const tenant = tenantOrganizationRepository.get(orgName);
  if (!options.allowNonActive && tenant && tenant.status !== 'active') {
    reply.status(409).send({ error: `Organization is not active: ${orgName}`, status: tenant.status });
    return null;
  }
  return orgName;
}

async function currentUsername(giteaService: GiteaService, request: FastifyRequest): Promise<string | null> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) return null;
  const user = await giteaService.validateToken(authorization.replace('token ', '').trim());
  return user?.username ?? null;
}
