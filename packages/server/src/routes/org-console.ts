import crypto from 'node:crypto';
import { buildGiteaUsername, parseGiteaUsername, validateMemberUsername, validatePassword } from '@esl/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  OperationRepository,
  OperationSecretRepository,
  SkillRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import type { OperationExecutor } from '../services/operation-executor.js';
import { encryptApplicationSecret } from '../services/application-secret.js';
import { isOrganizationAdministrator } from '../services/org-admin-auth.js';
import { DEFAULT_TEAM_DISPLAY_NAMES } from '../services/org-team-model.js';

export interface OrgConsoleRouteOptions {
  giteaService: GiteaService;
  repository: SkillRepository;
  passwordMinLength?: number;
  operationRepository: OperationRepository;
  operationSecretRepository: OperationSecretRepository;
  operationExecutor: OperationExecutor;
  tenantOrganizationRepository: TenantOrganizationRepository;
  applicationEncryptionKey?: string;
}

// ADR-0026 四个默认团队:只读/读写/技能管理/系统管理,不可删除、不可改名。
const DEFAULT_TEAM_NAMES = new Set(['all-readers', 'all-writers', 'all-managers', 'system-admins']);

// 三个全员团队(成员自动同步为全部组织成员)不展示于团队管理界面:
// 组织共享级别承载它们的授权,系统管理团队与自定义团队才是可管理的对象。
const HIDDEN_DEFAULT_TEAM_NAMES = new Set(['all-readers', 'all-writers', 'all-managers']);

// 团队显示名(ADR-0029):ESL 侧可选展示字段,允许中文,最长 64 字符。
const TEAM_DISPLAY_NAME_MAX = 64;

export function registerOrgConsoleRoutes(app: FastifyInstance, options: OrgConsoleRouteOptions): void {
  const { giteaService, repository, tenantOrganizationRepository } = options;

  app.get('/api/orgs/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    return giteaService.listOrgMembers(org);
  });

  // 被禁用的成员已被移出组织,不在普通成员列表中;从 Git Backend 全量用户
  // 中按组织前缀过滤出 prohibit_login 的用户,供组织管理员从列表直接启用。
  // (禁用由 ESL 设置为 prohibit_login,active 字段不变,不能作为禁用判据)
  app.get('/api/orgs/members/disabled', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const users = await giteaService.listUsers(`${org}_`);
    return users
      .filter((user) => user.username.startsWith(`${org}_`) && user.prohibit_login === true)
      .map((user) => ({ id: user.id, username: user.username, email: user.email }));
  });

  app.post('/api/orgs/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const { username = '', password = '' } = request.body as { username?: string; password?: string };
    const usernameValidation = validateMemberUsername(username);
    if (!usernameValidation.success) {
      return reply.status(400).send({ error: usernameValidation.errors.join(', ') });
    }
    const initialPassword = password || generateRandomPassword();
    const passwordValidation = validatePassword(initialPassword, options.passwordMinLength);
    if (!passwordValidation.success) {
      return reply.status(400).send({ error: passwordValidation.errors.join(', ') });
    }
    const giteaUsername = buildGiteaUsername(org, username);
    if (!giteaUsername) {
      return reply.status(400).send({ error: 'Member username produces a Gitea username that is too long' });
    }
    const operation = createMemberOperation(options, 'create', org, giteaUsername, initialPassword);
    if (!operation) {
      return reply.status(503).send({ error: 'Member operation secret storage is unavailable' });
    }
    void options.operationExecutor.process(operation.id);
    const result: { status: string; username: string; operationId: number; password?: string } = {
      status: 'pending',
      username: giteaUsername,
      operationId: operation.id
    };
    if (!password) {
      result.password = initialPassword;
    }
    return reply.status(202).send(result);
  });

  app.post('/api/orgs/members/:username/disable', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    const giteaUsername = buildGiteaUsername(org, username);
    if (!giteaUsername) {
      return reply.status(400).send({ error: 'Member username produces a Gitea username that is too long' });
    }
    // 组织管理员账号是组织唯一 Owner 与治理入口,禁用后无恢复路径,
    // 不属于组织管理员自身可操作的范围。
    if (giteaUsername === `${org}_admin`) {
      return reply.status(400).send({ error: 'Organization administrator cannot be disabled' });
    }
    const operation = options.operationRepository.createOperation({
      idempotencyKey: operationIdempotencyKey(request, 'disable', org, giteaUsername),
      kind: 'member.disable',
      payload: { orgName: org, username: giteaUsername }
    });
    void options.operationExecutor.process(operation.id);
    return reply.status(202).send({ status: 'pending', username: giteaUsername, operationId: operation.id });
  });

  app.post('/api/orgs/members/:username/enable', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    const giteaUsername = buildGiteaUsername(org, username);
    if (!giteaUsername) {
      return reply.status(400).send({ error: 'Member username produces a Gitea username that is too long' });
    }
    const operation = options.operationRepository.createOperation({
      idempotencyKey: operationIdempotencyKey(request, 'enable', org, giteaUsername),
      kind: 'member.enable',
      payload: { orgName: org, username: giteaUsername }
    });
    void options.operationExecutor.process(operation.id);
    return reply.status(202).send({ status: 'pending', username: giteaUsername, operationId: operation.id });
  });

  app.post('/api/orgs/members/:username/password', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    const { password = '' } = request.body as { password?: string };
    const resolvedPassword = password || generateRandomPassword();
    const passwordValidation = validatePassword(resolvedPassword, options.passwordMinLength);
    if (!passwordValidation.success) {
      return reply.status(400).send({ error: passwordValidation.errors.join(', ') });
    }
    const giteaUsername = buildGiteaUsername(org, username);
    if (!giteaUsername) {
      return reply.status(400).send({ error: 'Member username produces a Gitea username that is too long' });
    }
    const operation = createMemberOperation(options, 'password', org, giteaUsername, resolvedPassword, request);
    if (!operation) {
      return reply.status(503).send({ error: 'Member operation secret storage is unavailable' });
    }
    void options.operationExecutor.process(operation.id);
    const result: { status: string; username: string; operationId: number; password?: string } = {
      status: 'pending',
      username: giteaUsername,
      operationId: operation.id
    };
    if (!password) {
      result.password = resolvedPassword;
    }
    return reply.status(202).send(result);
  });

  app.get('/api/orgs/teams', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    // ADR-0025:对外统一 ESL 三档词汇,Gitea 的 admin 级团队呈现为 manage。
    // ADR-0026:Owners 团队不属于团队管理界面,仅含组织 admin 账号,不返回;
    // 三个全员团队(只读/读写/技能管理)由组织共享级别承载,同样不展示。
    // ADR-0029:返回 display_name;默认团队(如 system-admins)的显示名为平台
    // 预置数据,读时惰性播种,回填存量组织,避免从「系统管理团队」回退成英文。
    return (await giteaService.listTeams(org))
      .filter((team) => team.permission !== 'owner' && !HIDDEN_DEFAULT_TEAM_NAMES.has(team.name))
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

  app.post('/api/orgs/teams', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const body = request.body as { name?: string; permission?: string; display_name?: unknown };
    const { name = '', permission = '' } = body;
    if (!/^[a-z0-9-]{1,64}$/.test(name)) {
      return reply.status(400).send({ error: 'Team name must use lowercase letters, digits, and hyphens' });
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

  app.delete('/api/orgs/teams/:teamId', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const team = (await giteaService.listTeams(org)).find((entry) => entry.id === teamId);
    if (!team) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    // 系统团队不可删除:默认团队之外,Owners 是组织治理根基
    // (org-init 依赖它定位组织所有者,删除后组织在 Git Backend 失去 Owner)。
    if (DEFAULT_TEAM_NAMES.has(team.name) || team.permission === 'owner') {
      return reply.status(400).send({ error: 'System teams cannot be deleted' });
    }
    await giteaService.deleteTeam(teamId);
    // ADR-0029:删除团队后清理其显示名记录,不留孤儿数据。
    tenantOrganizationRepository.deleteTeamProfile(org, teamId);
    return { deleted: true };
  });

  // 自定义团队编辑(ADR-0029):标识名、权限档、显示名三者可选修改。标识名与
  // 权限档经 Gitea(权限变更连带 units_map,保证单元级授权一致);显示名只落
  // ESL DB,仅显示名变化时不调 Gitea。默认团队不可编辑(ADR-0026)。
  // 权限档是跨技能联动开关:矩阵按团队当前权限实时派生,变更即改变该团队
  // 挂载的所有技能上全体成员的访问级别——前端对此做影响面提示与二次确认。
  app.patch('/api/orgs/teams/:teamId', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const team = (await giteaService.listTeams(org)).find((entry) => entry.id === teamId);
    if (!team) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    if (DEFAULT_TEAM_NAMES.has(team.name) || team.permission === 'owner') {
      return reply.status(400).send({ error: 'System teams cannot be edited' });
    }
    const body = request.body as { name?: string; permission?: string; display_name?: unknown };
    if (body.name !== undefined && !/^[a-z0-9-]{1,64}$/.test(body.name)) {
      return reply.status(400).send({ error: 'Team name must use lowercase letters, digits, and hyphens' });
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

  app.get('/api/orgs/teams/:teamId/members', async (request, reply) => {
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
  app.get('/api/orgs/teams/:teamId/skills-count', async (request, reply) => {
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

  app.post('/api/orgs/teams/:teamId/members', async (request, reply) => {
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
    const giteaUsername = buildGiteaUsername(org, username);
    if (!giteaUsername) {
      return reply.status(400).send({ error: 'Member username produces a Gitea username that is too long' });
    }
    await giteaService.addTeamMember(teamId, giteaUsername);
    return reply.status(201).send({ teamId, username: giteaUsername });
  });

  app.delete('/api/orgs/teams/:teamId/members/:username', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const username = decodeURIComponent((request.params as { username: string }).username);
    const team = (await giteaService.listTeams(org)).find((entry) => entry.id === teamId);
    if (!team) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    const giteaUsername = `${org}_${username}`;
    // 组织管理员是组织唯一 Owner 与治理入口,不可从 Owners 团队移除
    // (与禁用自身同一治理约束:移出后组织在 Git Backend 失去 Owner)。
    if (team.permission === 'owner' && giteaUsername === `${org}_admin`) {
      return reply.status(400).send({ error: 'Organization administrator cannot be removed from the Owners team' });
    }
    // ADR-0026:admin 账号自动加入系统管理团队且不可移出,保证组织永远
    // 保有治理兜底入口;其余成员由持有组织管理权者自由增删。
    if (team.name === 'system-admins' && giteaUsername === `${org}_admin`) {
      return reply.status(400).send({ error: 'Organization administrator cannot be removed from the system admins team' });
    }
    await giteaService.removeTeamMember(teamId, giteaUsername);
    return { teamId, username: giteaUsername, removed: true };
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

async function requireOrgAdministrator(
  request: FastifyRequest,
  reply: FastifyReply,
  giteaService: GiteaService,
  tenantOrganizationRepository: TenantOrganizationRepository
): Promise<string | null> {
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
  // 组织从 Organization-scoped Account Name 前缀解析;组织名与成员名都不允许
  // 下划线,首个下划线切分无歧义。
  const parsed = parseGiteaUsername(user.username);
  if (!parsed || !(await giteaService.organizationExists(parsed.org))) {
    reply.status(403).send({ error: 'Forbidden: organization administrator token required' });
    return null;
  }
  const org = parsed.org;
  // 组织管理员是角色而非账号(ADR-0026):admin 账号 ∪ 系统管理团队成员。
  if (!(await isOrganizationAdministrator(giteaService, org, user.username))) {
    reply.status(403).send({ error: 'Forbidden: organization administrator token required' });
    return null;
  }
  // 处理中的组织(开通、失败、删除中、删除失败)禁止一切组织管理操作。
  const tenant = tenantOrganizationRepository.get(org);
  if (tenant && tenant.status !== 'active') {
    reply.status(409).send({ error: `Organization is not active: ${org}`, status: tenant.status });
    return null;
  }
  return org;
}

function generateRandomPassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}

function createMemberOperation(
  options: OrgConsoleRouteOptions,
  action: 'create' | 'password',
  org: string,
  username: string,
  password: string,
  request?: FastifyRequest
) {
  if (!options.applicationEncryptionKey) return undefined;
  const operation = options.operationRepository.createOperation({
    idempotencyKey:
      action === 'create'
        ? `member.create:${org}:${username}`
        : operationIdempotencyKey(request, 'password', org, username),
    kind: `member.${action}`,
    payload: action === 'create' ? { orgName: org, username } : { username }
  });
  options.operationSecretRepository.createIfAbsent(
    operation.id,
    encryptApplicationSecret(password, options.applicationEncryptionKey)
  );
  return operation;
}

function operationIdempotencyKey(
  request: FastifyRequest | undefined,
  action: string,
  org: string,
  username: string
): string {
  const supplied = request?.headers['idempotency-key'];
  const key = Array.isArray(supplied) ? supplied[0] : supplied;
  return key ? `member.${action}:${org}:${username}:${key}` : `member.${action}:${org}:${username}:${crypto.randomUUID()}`;
}
