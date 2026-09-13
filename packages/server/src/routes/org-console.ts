import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { validateMemberUsername } from '@esl/core';
import type {
  OrgInvitationRepository,
  PlatformSettingsRepository,
  SkillRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import { DEFAULT_TEAM_DISPLAY_NAMES } from '../services/org-team-model.js';

export interface OrgConsoleRouteOptions {
  giteaService: GiteaService;
  repository: SkillRepository;
  platformSettingsRepository: PlatformSettingsRepository;
  orgInvitationRepository: OrgInvitationRepository;
  tenantOrganizationRepository: TenantOrganizationRepository;
}

// 常设团队（ADR-0032）：只读 / 读写 / 技能管理三个常设团队 + Owners（管理员
// 团队）。不可删除、不可改名；成员加入组织自动进入前三个，离开自动移出。
const STANDING_TEAM_NAMES = new Set(['all-readers', 'all-writers', 'all-managers']);

// 团队显示名(ADR-0029):ESL 侧可选展示字段,允许中文,最长 64 字符。
const TEAM_DISPLAY_NAME_MAX = 64;

// 成员加入组织时的自动入组团队（三个常设团队；Owners 仅组织管理员）。
const AUTO_JOIN_TEAM_NAMES = STANDING_TEAM_NAMES;

export function registerOrgConsoleRoutes(app: FastifyInstance, options: OrgConsoleRouteOptions): void {
  const { giteaService, repository, platformSettingsRepository, orgInvitationRepository, tenantOrganizationRepository } =
    options;

  async function addMemberToStandingTeams(org: string, username: string): Promise<void> {
    const teams = await giteaService.listTeams(org);
    for (const team of teams) {
      if (AUTO_JOIN_TEAM_NAMES.has(team.name) && !(await giteaService.isTeamMember(team.id, username))) {
        await giteaService.addTeamMember(team.id, username);
      }
    }
  }

  async function removeMemberFromAllTeams(org: string, username: string): Promise<void> {
    const teams = await giteaService.listTeams(org);
    for (const team of teams) {
      if (await giteaService.isTeamMember(team.id, username)) {
        await giteaService.removeTeamMember(team.id, username);
      }
    }
  }

  app.get('/api/orgs/:orgName/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    return giteaService.listOrgMembers(org);
  });

  // 直接添加：把已注册的全局账号拉进组织并自动加入三个常设团队。
  app.post('/api/orgs/:orgName/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const { username = '' } = request.body as { username?: string };
    const usernameValidation = validateMemberUsername(username);
    if (!usernameValidation.success) {
      return reply.status(400).send({ error: usernameValidation.errors.join(', ') });
    }
    // 全局账号必须已存在：组织管理员只授予组织成员身份，不创建账号。
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

    await addMemberToStandingTeams(org, username);
    return reply.status(201).send({ status: 'added', username });
  });

  // 移出成员：自动从全部团队（含三个常设团队）移出并退出组织。
  app.delete('/api/orgs/:orgName/members/:username', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    if (!(await giteaService.listOrgMembers(org)).some((member) => member.username === username)) {
      return reply.status(404).send({ error: `User is not a member of ${org}` });
    }
    await removeMemberFromAllTeams(org, username);
    await giteaService.removeOrgMember(org, username);
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

  // 被邀请人接受邀请：加入组织并自动进入三个常设团队。
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
    await addMemberToStandingTeams(invitation.orgName, username);
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

  app.get('/api/orgs/:orgName/teams', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    // ADR-0025:对外统一 ESL 三档词汇,Gitea 的 admin 级团队呈现为 manage。
    // ADR-0032:Owners 与三个常设团队是授权载体,不属于可管理的自定义团队,
    // 不出现在团队管理界面。显示名读时惰性播种(ADR-0029)。
    return (await giteaService.listTeams(org))
      .filter((team) => team.permission !== 'owner' && !STANDING_TEAM_NAMES.has(team.name))
      .map((team) => {
        let displayName = tenantOrganizationRepository.getTeamDisplayName(org, team.id);
        if (displayName === undefined && DEFAULT_TEAM_DISPLAY_NAMES[team.name] !== undefined) {
          displayName = DEFAULT_TEAM_DISPLAY_NAMES[team.name];
          tenantOrganizationRepository.setTeamDisplayName(org, team.id, displayName);
        }
        return {
          ...team,
          display_name: displayName,
          permission: team.permission === 'admin' ? 'manage' : team.permission
        };
      });
  });

  app.post('/api/orgs/:orgName/teams', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const body = request.body as { name?: string; permission?: string; display_name?: unknown };
    const { name = '', permission = '' } = body;
    if (!/^[a-z0-9-]{1,64}$/.test(name)) {
      return reply.status(400).send({ error: 'Team name must use lowercase letters, digits, and hyphens' });
    }
    if (STANDING_TEAM_NAMES.has(name) || name === 'Owners') {
      return reply.status(400).send({ error: 'Team name is reserved for standing teams' });
    }
    // ADR-0025 三档:read/write/manage;ESL 的 manage 档映射为 Gitea admin 级团队,
    // 该团队被关联到技能仓库即获得代管权。
    if (permission !== 'read' && permission !== 'write' && permission !== 'manage') {
      return reply.status(400).send({ error: 'Team permission must be read, write, or manage' });
    }
    const displayName = normalizeTeamDisplayName(body.display_name);
    if (displayName !== null && displayName !== undefined && displayName.length > TEAM_DISPLAY_NAME_MAX) {
      return reply.status(400).send({ error: 'Team display name must be at most 64 characters' });
    }
    const team = await giteaService.createTeam(org, name, permission === 'manage' ? 'admin' : permission);
    // ADR-0029:显示名是 ESL 侧数据,创建成功后落库;空显示名视为未设置。
    if (displayName) {
      tenantOrganizationRepository.setTeamDisplayName(org, team.id, displayName);
    }
    return reply.status(201).send({
      ...team,
      display_name: displayName ?? undefined,
      permission: team.permission === 'admin' ? 'manage' : team.permission
    });
  });

  app.delete('/api/orgs/:orgName/teams/:teamId', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const team = (await giteaService.listTeams(org)).find((entry) => entry.id === teamId);
    if (!team) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    // 常设团队与 Owners 不可删除(ADR-0032):授权载体必须稳定。
    if (STANDING_TEAM_NAMES.has(team.name) || team.permission === 'owner') {
      return reply.status(400).send({ error: 'Standing teams cannot be deleted' });
    }
    await giteaService.deleteTeam(teamId);
    // ADR-0029:删除团队后清理其显示名记录,不留孤儿数据。
    tenantOrganizationRepository.deleteTeamProfile(org, teamId);
    return { deleted: true };
  });

  // 自定义团队编辑(ADR-0029):标识名、权限档、显示名三者可选修改。标识名与
  // 权限档经 Gitea(权限变更连带 units_map,保证单元级授权一致);显示名只落
  // ESL DB,仅显示名变化时不调 Gitea。常设团队不可编辑(ADR-0032)。
  // 权限档是跨技能联动开关:矩阵按团队当前权限实时派生,变更即改变该团队
  // 挂载的所有技能上全体成员的访问级别——前端对此做影响面提示与二次确认。
  app.patch('/api/orgs/:orgName/teams/:teamId', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const team = (await giteaService.listTeams(org)).find((entry) => entry.id === teamId);
    if (!team) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    if (STANDING_TEAM_NAMES.has(team.name) || team.permission === 'owner') {
      return reply.status(400).send({ error: 'Standing teams cannot be edited' });
    }
    const body = request.body as { name?: string; permission?: string; display_name?: unknown };
    if (body.name !== undefined && !/^[a-z0-9-]{1,64}$/.test(body.name)) {
      return reply.status(400).send({ error: 'Team name must use lowercase letters, digits, and hyphens' });
    }
    if (body.name !== undefined && (STANDING_TEAM_NAMES.has(body.name) || body.name === 'Owners')) {
      return reply.status(400).send({ error: 'Team name is reserved for standing teams' });
    }
    if (
      body.permission !== undefined &&
      body.permission !== 'read' &&
      body.permission !== 'write' &&
      body.permission !== 'manage'
    ) {
      return reply.status(400).send({ error: 'Team permission must be read, write, or manage' });
    }
    // 显示名:字段存在即覆盖(空串/空 → 清空),不存在则保持。
    let displayNameChange: string | null | undefined;
    if (body.display_name !== undefined) {
      displayNameChange = normalizeTeamDisplayName(body.display_name);
      if (displayNameChange != null && displayNameChange.length > TEAM_DISPLAY_NAME_MAX) {
        return reply.status(400).send({ error: 'Team display name must be at most 64 characters' });
      }
    }
    // 仅当标识名/权限档实际变化才调 Gitea(Gitea EditTeam 是部分更新)。
    const giteaChanges: { name?: string; permission?: 'read' | 'write' | 'admin' } = {};
    if (body.name !== undefined && body.name !== team.name) {
      giteaChanges.name = body.name;
    }
    let giteaPermission: 'read' | 'write' | 'admin' | undefined;
    if (body.permission === 'manage') giteaPermission = 'admin';
    else if (body.permission === 'read' || body.permission === 'write') giteaPermission = body.permission;
    if (giteaPermission !== undefined && giteaPermission !== team.permission) {
      giteaChanges.permission = giteaPermission;
    }
    let updatedTeam = team;
    if (Object.keys(giteaChanges).length > 0) {
      updatedTeam = await giteaService.updateTeam(teamId, giteaChanges);
    }
    if (displayNameChange !== undefined) {
      tenantOrganizationRepository.setTeamDisplayName(org, teamId, displayNameChange);
    }
    const displayName =
      displayNameChange ?? tenantOrganizationRepository.getTeamDisplayName(org, teamId);
    return {
      ...updatedTeam,
      display_name: displayName ?? undefined,
      permission: updatedTeam.permission === 'admin' ? 'manage' : updatedTeam.permission
    };
  });

  app.get('/api/orgs/:orgName/teams/:teamId/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    if (!(await orgHasTeam(giteaService, org, teamId))) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    return giteaService.listTeamMembers(teamId);
  });

  // ADR-0029:该团队已授权的技能数(= 团队挂载仓库中属于本组织技能仓库的数量)。
  // 供前端编辑对话框在权限档变更时展示影响面("该团队已授权 N 个技能")。
  // gitRepoPath 与 Gitea repo full_name 同为 "{owner}/{name}",直接匹配。
  app.get('/api/orgs/:orgName/teams/:teamId/skills-count', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
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
    const teamRepos = await giteaService.listTeamRepos(teamId);
    const skillsCount = teamRepos.filter((repo) => skillRepoKeys.has(repo.full_name)).length;
    return { teamId, skillsCount };
  });

  // 团队成员授权:逐团队添加/移除成员(ADR-0032 权限矩阵的团队载体)。
  app.post('/api/orgs/:orgName/teams/:teamId/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const { username = '' } = request.body as { username?: string };
    const usernameValidation = validateMemberUsername(username);
    if (!usernameValidation.success) {
      return reply.status(400).send({ error: usernameValidation.errors.join(', ') });
    }
    if (!(await orgHasTeam(giteaService, org, teamId))) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    await giteaService.addTeamMember(teamId, username);
    return reply.status(201).send({ teamId, username });
  });

  app.delete('/api/orgs/:orgName/teams/:teamId/members/:username', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const username = decodeURIComponent((request.params as { username: string }).username);
    const team = (await giteaService.listTeams(org)).find((entry) => entry.id === teamId);
    if (!team) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    // Owners 团队承载组织管理权:组织管理员不可被移出(治理兜底入口)。
    if (team.permission === 'owner') {
      const owners = await giteaService.listTeamMembers(teamId);
      if (owners.some((member) => member.username === username)) {
        return reply.status(400).send({ error: 'Organization administrators cannot be removed from the Owners team' });
      }
    }
    await giteaService.removeTeamMember(teamId, username);
    return { teamId, username, removed: true };
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

// 全局身份（ADR-0032）：组织从 URL 的 :orgName 提供，管理员 = Owners 团队成员。
async function requireOrgAdministrator(
  request: FastifyRequest,
  reply: FastifyReply,
  giteaService: GiteaService,
  tenantOrganizationRepository: TenantOrganizationRepository
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
    reply.status(403).send({ error: 'Forbidden: organization administrator token required' });
    return null;
  }
  if (!(await giteaService.organizationExists(orgName))) {
    reply.status(403).send({ error: 'Forbidden: organization administrator token required' });
    return null;
  }
  // Organization Admin = Owners 团队成员（ADR-0032），任何成员皆可治理。
  let owners: Array<{ username: string }> = [];
  try {
    owners = await giteaService.listOrgOwners(orgName);
  } catch {
    owners = [];
  }
  if (!owners.some((owner) => owner.username === user.username)) {
    reply.status(403).send({ error: 'Forbidden: organization administrator token required' });
    return null;
  }
  // 处理中的组织(删除中、删除失败)禁止一切组织管理操作。
  const tenant = tenantOrganizationRepository.get(orgName);
  if (tenant && tenant.status !== 'active') {
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
