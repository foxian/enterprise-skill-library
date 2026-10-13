import { apiError } from '../errors.js';
import {
  DISPLAY_NAME_MAX_LENGTH,
  highestStableVersion,
  ReleaseGraphError,
  releaseGraphErrorStatus,
  resolveReleaseGraph,
  SHARE_TIER_TEAM_NAMES,
  STANDING_TEAM_NAMES,
  parseSkillName,
  parseSkillIdentity,
  sortVersionsDescending,
  validateReleaseManifest,
  type ReleaseLockEntry
} from '@esl/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import semver from 'semver';
import type {
  AdminRepository,
  DownloadLogRepository,
  SkillRecord,
  SkillRepository,
  SkillTeamGrantRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import type { GiteaAdminUser, GiteaService, GiteaTeam } from '../services/gitea.js';
import { isOwnerMemberOf } from '../services/organization-membership.js';
import { parseClientUserAgent, truncateClientIp } from '../services/download-log.js';
import {
  canManageSkill,
  getAccessLevel,
  hasReadAccess,
  skillRepo,
  type SkillAccessLevel
} from '../services/skill-access.js';
import { backendTeamName } from '../services/logical-team-projection.js';
import { ServerReleaseGraphSource } from '../services/release-graph-source.js';
import { logEvent } from '../logging.js';
import type { ApiErrorCode } from '@esl/i18n';

export interface SkillsRouteOptions {
  repository: SkillRepository;
  adminRepository?: AdminRepository;
  giteaService: GiteaService;
  repoOwner: string;
  tenantOrganizationRepository: TenantOrganizationRepository;
  skillTeamGrantRepository: SkillTeamGrantRepository;
  packageRoot?: string;
  downloadLogRepository?: DownloadLogRepository;
}

// ADR-0064:依赖 Gitea Organization 团队的技能授权动作。个人命名空间(技能的
// git 仓库属主是一名 Skill User)没有组织团队,对这些动作显式拒绝。
const ORG_LEVEL_PERMISSION_ACTIONS = new Set([
  'share_all_read',
  'share_all_write',
  'share_all_manage',
  'set_team',
  'remove_team'
]);

// 技能生命周期的关键状态变化事件（ADR-0045）。resourceId 优先用 Skill ID——
// 它在 Skill Rename 后仍然稳定，比可变的名字更适合做检索键；errorCode 与响应
// 体里的 API Error Code 对齐，便于把客户端看到的拒绝与服务端日志关联。
interface SkillEventInput {
  event: 'skill.source-upload' | 'skill.published';
  outcome: 'succeeded' | 'failed';
  message: string;
  actorUsername: string;
  scope: string;
  name: string;
  skillId?: string;
  errorCode?: ApiErrorCode;
  durationMs?: number;
}

function logSkillEvent(request: FastifyRequest, input: SkillEventInput): void {
  logEvent(
    request.log,
    input.outcome === 'succeeded' ? 'info' : 'warn',
    {
      event: input.event,
      outcome: input.outcome,
      actorUsername: input.actorUsername,
      organization: input.scope,
      resourceType: 'skill',
      resourceId: input.skillId ?? input.name,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {})
    },
    input.message
  );
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
  const downloadLogRepository = options.downloadLogRepository;

  // 包发放端点是唯一的下载事件记录点（ADR-0067）：依赖解析由 CLI 逐包 GET
  // 实现，因此根技能与每个依赖节点天然各构成一次独立下载，无需区分触发来源。
  // 客户端 IP 只落截断网段，User-Agent 拆成环境字段，requested specifier 由
  // CLI 以 ?requested= 附带——三者缺失时对应字段为 null，不影响计数。
  const recordDownload = (
    request: FastifyRequest,
    input: {
      skillId?: string | null;
      skillIdentity?: string | null;
      version?: string | null;
      user?: { username: string; id?: string } | null;
      result: 'success' | 'failure';
      failureReason?: string | null;
    }
  ): void => {
    if (!downloadLogRepository) return;
    const requested = (request.query as { requested?: unknown }).requested;
    downloadLogRepository.record({
      skillId: input.skillId ?? null,
      skillIdentity: input.skillIdentity ?? null,
      version: input.version ?? null,
      requestedSpecifier: typeof requested === 'string' && requested.trim() ? requested.trim() : null,
      userId: input.user?.id ?? null,
      username: input.user?.username ?? null,
      clientIpTruncated: truncateClientIp(clientIpOf(request)),
      ...parseClientUserAgent(request.headers['user-agent']),
      result: input.result,
      failureReason: input.failureReason ?? null
    });
  };

  // 整技能 Delete/Restore 使用同一权限模型（ADR-0040）：平台管理员兜底；
  // 未发布技能由 manage 权限处理；曾发布技能只升级到组织 Owners 或个人
  // owner/creator，普通 manage 授权者与组织管理成员不得删除公共发布资产。
  const canDeleteWholeSkill = async (
    skill: SkillRecord,
    username: string,
    isPlatformAdmin: boolean
  ): Promise<boolean> => {
    if (isPlatformAdmin) return true;
    if (!repository.hasEverPublished(skill.name)) {
      return await canManageSkill(giteaService, skill, username);
    }
    if (skill.owner === username || skill.createdBy === username) return true;
    return await isOwnerMemberOf(giteaService, skill.scope, username);
  };

  const canRestoreSkill = canDeleteWholeSkill;

  // ADR-0064:组织级授权(全组织档位与技能团队授权)只对活跃租户组织存在。
  // 个人命名空间没有租户记录;已删除/删除中的组织不再治理。冻结中的组织仍属
  // 活跃租户,团队授权照常(平台管理员治理可见性由 preHandler 单独放宽)。
  const isOrgNamespace = (scope: string): boolean =>
    tenantOrganizationRepository.get(scope)?.status === 'active';

  // 权限矩阵的响应体;读路径(GET)与变更路径(POST)共用同一形状——客户端用响应整体
  // 替换本地状态,两个路由少一个字段就会让界面状态退化(变更后控件集体失效)。
  const buildPermissionsResponse = async (
    skill: SkillRecord,
    username: string,
    isPlatformAdmin = false
  ) => ({
    ...(await getPermissionMatrix(
      giteaService,
      tenantOrganizationRepository,
      skillTeamGrantRepository,
      skill
    )),
    // 归属(A6/ADR-0064):面板据隐藏全组织授权与团队授权卡;个人技能只有协作者授权
    personalNamespace: !isOrgNamespace(skill.scope),
    skill: buildSkillContext(repository, skill, downloadLogRepository),
    // 查看者自己的权限档:与变更守门、技能列表的 access 用同一套判定(getAccessLevel),
    // 前端据此决定变更类控件是否可用,避免「点了才知道 403」。
    viewerAccess: await getAccessLevel(giteaService, skill, username),
    // 生命周期按钮单独下发:平台管理员不一定持有仓库 manage，但一定可 Restore/Delete。
    viewerLifecycle: {
      canArchive: await canManageSkill(giteaService, skill, username),
      canRestore: await canRestoreSkill(skill, username, isPlatformAdmin),
      canDelete: await canDeleteWholeSkill(skill, username, isPlatformAdmin)
    }
  });

  app.post('/api/skills/upload', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send(apiError('unauthorizedInvalidToken'));
    }

    // ADR-0032:release.json v3 的 name 是归属的唯一权威来源。无 scope 的裸名
    // 解析为上传者个人命名空间;@scope/short 需上传者持有该命名空间(本人或
    // 组织成员)。身份在首次 Source Upload 固定。
    const body = request.body as { name?: string; description?: string; displayName?: string };
    const identity = parseSkillIdentity(body.name ?? '');
    if (!identity) {
      return reply.status(400).send(apiError('skillNameMustUseLowercaseLettersDigitsAndHyphens'));
    }
    if (!body.description) {
      return reply.status(400).send(apiError('skillDescriptionIsRequired'));
    }
    // 显示名（ADR-0048）：随 Source Upload 同步当前源码值；trim 后空串按未设置，
    // 长度上限与 release.json 校验一致。
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : undefined;
    if (displayName !== undefined && displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      return reply.status(400).send(apiError('skillDisplayNameTooLong'));
    }

    let scope: string;
    if (identity.scope === null || identity.scope === user.username) {
      scope = user.username;
    } else {
      // 组织命名空间:要求组织激活且上传者是成员(任何成员皆可 upload,ADR-0032)。
      const tenant = tenantOrganizationRepository.get(identity.scope);
      if (!tenant || tenant.status !== 'active') {
        return reply
          .status(403)
          .send(apiError('organizationNotActiveForUpload', { org: identity.scope ?? '' }));
      }
      let member = false;
      try {
        member = (await giteaService.listOrgMembers(identity.scope)).some((m) => m.username === user.username);
      } catch {
        member = false;
      }
      if (!member) {
        return reply.status(403).send(apiError('notMemberOfOrganization', { org: identity.scope }));
      }
      scope = identity.scope;
    }

    const shortName = identity.shortName;
    const name = `@${scope}/${shortName}`;
    const existing = repository.getSkill(name);
    if (existing) {
      if (existing.status !== 'active-unreleased' || existing.createdBy !== user.username) {
        return reply.status(409).send(apiError('skillAlreadyExistsUseSourceAndGitPushToUpdateIt'));
      }
      // An interrupted first Source Upload: the same creator may resume against
      // the Active Unreleased Skill Source instead of hitting a duplicate error.
      // 断点续传同样补齐创建者的 Git 访问权：修复前注册的来源可能从未授权。
      await ensureSourceCreatorGitAccess(giteaService, scope, shortName, user.username);
      logSkillEvent(request, {
        event: 'skill.source-upload',
        outcome: 'succeeded',
        message: 'Skill source upload resumed',
        actorUsername: user.username,
        scope,
        name,
        skillId: existing.skillId
      });
      return reply
        .status(200)
        .send(withCloneUrl(request, { ...existing, versions: repository.getVersions(name) }));
    }

    let gitRepo: { full_name: string } | undefined;
    let skill: ReturnType<SkillRepository['createServerSkill']> | undefined;
    try {
      gitRepo = await giteaService.createRepo(scope, shortName, true);
      // 组织命名空间的技能仓库是私有的且只挂组织 owners 团队，而 ADR-0032
      // 允许任何成员 upload；创建者必须在 Gitea 层显式持有访问权（manage 档
      // → admin 级协作者，ADR-0025），否则首次 Git push 会被 Gitea 以
      // "Repository not found" 拒绝。
      await ensureSourceCreatorGitAccess(giteaService, scope, shortName, user.username);
      skill = repository.createServerSkill({
        name,
        scope,
        skillName: shortName,
        description: body.description,
        displayName,
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
    logSkillEvent(request, {
      event: 'skill.source-upload',
      outcome: 'succeeded',
      message: 'Skill source uploaded',
      actorUsername: user.username,
      scope,
      name,
      skillId: skill!.skillId
    });
    return reply.status(201).send(withCloneUrl(request, { ...skill!, versions: repository.getVersions(name) }));
  });

  app.get('/api/skills/search', async (request, reply) => {
    // 可安装技能发现面（ADR-0049）：匿名可浏览 public 已发布技能，登录后
    // 附加有权的 private；结果由本路由一次 enrich，CLI 不做逐条 info。
    const { q = '', namespace, keyword, visibility, limit } = request.query as {
      q?: string;
      namespace?: string;
      keyword?: string;
      visibility?: string;
      limit?: string;
    };
    if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') {
      return reply.status(400).send(apiError('visibilityMustBePublicOrPrivate'));
    }
    let limitCount = 50;
    if (limit !== undefined) {
      const parsed = Number(limit);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return reply
          .status(400)
          .send(apiError('validationFailed', { detail: 'limit must be a positive integer' }));
      }
      limitCount = parsed;
    }
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user && visibility === 'private') {
      return reply.status(401).send(apiError('unauthorizedMissingToken'));
    }
    const lowerQuery = q.toLowerCase();
    const lowerKeyword = keyword?.trim().toLowerCase();
    const results: Array<{
      name: string;
      scope: string;
      skillName: string;
      description: string;
      displayName: string;
      latestStableVersion?: string;
      visibility: string;
      skillId?: string;
    }> = [];
    // query 还要匹配显示名与 keywords（不在 skills 表），文本匹配统一在
    // 内存里做，DB 只承担已发布状态与 namespace 过滤。
    for (const skill of repository.searchSkills('', { namespace: namespace?.trim() || undefined })) {
      // public 是全员可读基线；private 需要有效登录与读权限。
      if (visibility && skill.visibility !== visibility) continue;
      if (skill.visibility !== 'public' && !(user && (await hasReadAccess(giteaService, skill, user.username)))) {
        continue;
      }
      // 未发布（无任何 Skill Release）的技能不可安装，不进入发现面。
      const releases = repository.getReleases(skill.name);
      if (releases.length === 0) continue;
      // getReleases 按 id 倒序 = 发布时间最新（含 prerelease，ADR-0048）。
      const latestRelease = releases[0];
      // Keywords 与 displayName 一样取最新 Release 快照；历史 Release 已移除的关键词不应继续命中目录。
      const keywords = new Set<string>();
      const manifestKeywords = (latestRelease.releaseManifest as { keywords?: unknown }).keywords;
      if (Array.isArray(manifestKeywords)) {
        for (const entry of manifestKeywords) {
          if (typeof entry === 'string') keywords.add(entry.toLowerCase());
        }
      }
      const displayName = searchDisplayName(latestRelease.releaseManifest, skill.skillName);
      if (lowerQuery) {
        const haystack = [skill.name, skill.description, displayName, ...keywords].join('\n').toLowerCase();
        if (!haystack.includes(lowerQuery)) continue;
      }
      if (lowerKeyword && !keywords.has(lowerKeyword)) continue;
      results.push({
        name: skill.name,
        scope: skill.scope,
        skillName: skill.skillName,
        description: skill.description,
        displayName,
        latestStableVersion: highestStableVersion(releases.map((release) => release.version)) ?? undefined,
        visibility: skill.visibility,
        skillId: skill.skillId
      });
      if (results.length >= limitCount) break;
    }
    // 下载量（跨版本汇总）是公开信号：匿名浏览公开技能时同样返回（ADR-0067）。
    return withDownloadCounts(results, downloadLogRepository);
  });

  // 角色化技能清单(ADR-0032):与 search(只返回已发布、面向安装消费)不同,
  // 这里返回调用方可见的全部技能(含未发布)及其权限关系,供管理后台的
  // "我管理的/共享给我的"与超管、所有者成员视图消费。可见性 = public ∪
  // 被授权 private,跨命名空间不再按调用者组织隔离;
  // relation: managed=持有管理权, shared=可读/可写但无管理权。
  app.get('/api/skills/inventory', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send(apiError('unauthorizedInvalidToken'));
    }
    // ADR-0064 契约显式化:不再 SkillRecord 全字段展开,只返回列表需要的字段,
    // 描述供技能信息列预览，显式返回；owner 等字段仍不透传。scope/skillName 保留结构化
    // 冗余,客户端不解析 name 字符串。personalNamespace 驱动列表的归属徽标与
    // 共享状态的空占位(A6 决策)。
    const view: Array<{
      name: string;
      scope: string;
      skillName: string;
      displayName: string | null;
      description: string;
      createdBy: string;
      status?: string;
      personalNamespace: boolean;
      access: SkillAccessLevel;
      relation: 'managed' | 'shared';
      skillId?: string;
    }> = [];
    for (const skill of repository.listSkills()) {
      const access = await getAccessLevel(giteaService, skill, user.username);
      if (access === 'none') continue;
      view.push({
        name: skill.name,
        scope: skill.scope,
        skillName: skill.skillName,
        displayName: resolveSkillDisplayName(repository, skill),
        description: skill.description,
        createdBy: skill.createdBy,
        status: skill.status,
        personalNamespace: !isOrgNamespace(skill.scope),
        access,
        relation: access === 'manage' ? 'managed' : 'shared',
        skillId: skill.skillId
      });
    }
    // 下载量（跨版本汇总）随技能清单一起返回，供管理后台列表与技能管理面板展示
    // （ADR-0067）。
    return withDownloadCounts(view, downloadLogRepository);
  });

  // 可见性切换(ADR-0033):Maintainer 或所有者成员可在 public/private
  // 间切换。public = 平台全员可搜可装可作依赖;private = 仅 Maintainer 与被授权者。
  app.post('/api/skills/:scope/:skillName/visibility', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send(apiError('unauthorizedInvalidToken'));
    }
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const skill = repository.getSkill(name);
    if (!skill) {
      return reply.status(404).send(apiError('skillNotFound'));
    }
    if (!(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    const { visibility = '' } = request.body as { visibility?: string };
    if (visibility !== 'public' && visibility !== 'private') {
      return reply.status(400).send(apiError('visibilityMustBePublicOrPrivate'));
    }
    repository.setVisibility(name, visibility);
    return { name: skill.name, visibility };
  });

  app.get('/api/skills/:scope/:skillName/permissions', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send(apiError('unauthorizedInvalidToken'));
    }
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const skill = repository.getSkill(name);
    if (!skill) {
      return reply.status(404).send(apiError('skillNotFound'));
    }
    // 读矩阵与技能上下文不是敏感数据:任何对该技能有可见性的用户都能查看;变更仍走 POST 的管理权守门。
    if (!(await hasReadAccess(giteaService, skill, user.username))) {
      return reply.status(403).send(apiError('forbiddenNoAccessToThisPrivateSkillRequestAccessFromItsMaintainers'));
    }
    return buildPermissionsResponse(
      skill,
      user.username,
      await authorizePlatformAdministrator(request, adminRepository, giteaService)
    );
  });

  // 技能描述随 Source Upload 更新(CONTEXT:Skill Description):仅 Maintainer
  // 可改,直接落库,不涉及 Git Backend。
  app.put('/api/skills/:scope/:skillName/description', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send(apiError('unauthorizedInvalidToken'));
    }
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const skill = repository.getSkill(name);
    if (!skill) {
      return reply.status(404).send(apiError('skillNotFound'));
    }
    if (!(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    const body = request.body as { description?: string };
    if (typeof body.description !== 'string' || !body.description.trim()) {
      return reply.status(400).send(apiError('skillDescriptionIsRequired'));
    }
    repository.updateSkillDescription(name, body.description.trim());
    return { name: skill.name, description: body.description.trim() };
  });

  // 显示名当前源码值（ADR-0048）：随 Source Upload 同步，也可由 Maintainer 直接改。
  // 仅 Maintainer 可改，直接落库，不涉及 Git Backend；空串/缺失即清空。已发布后
  // 对外标题由最近 Release 快照覆盖，此处改的是未发布展示值。
  app.put('/api/skills/:scope/:skillName/display-name', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send(apiError('unauthorizedInvalidToken'));
    }
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const skill = repository.getSkill(name);
    if (!skill) {
      return reply.status(404).send(apiError('skillNotFound'));
    }
    if (!(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    const body = request.body as { displayName?: string };
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : undefined;
    if (displayName !== undefined && displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      return reply.status(400).send(apiError('skillDisplayNameTooLong'));
    }
    repository.updateSkillDisplayName(name, displayName || null);
    // 空串/缺失统一清空为 null，响应与落库一致（避免返回 '' 而库里是 null）。
    return { name: skill.name, displayName: displayName || null };
  });

  app.get('/api/skills/:scope/:skillName/permission-candidates', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) return reply.status(401).send(apiError('unauthorizedInvalidToken'));
    const params = request.params as { scope: string; skillName: string };
    const scope = decodeURIComponent(params.scope).replace(/^@/, '');
    const skill = repository.getSkill(`@${scope}/${decodeURIComponent(params.skillName)}`);
    if (!skill) return reply.status(404).send(apiError('skillNotFound'));
    if (!(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    const query = (request.query as { q?: string }).q?.trim() ?? '';
    const repo = skillRepo(skill);
    const grantedMembers = new Set((await giteaService.listCollaborators(repo.owner, repo.name)).map(member => member.username));
    if (!isOrgNamespace(skill.scope)) {
      // 个人技能只支持完整用户名精确查询，不提供平台用户目录。
      const members = query ? (await giteaService.listUsers())
        .filter(member => member.username === query && isEnabledMember(member) && !grantedMembers.has(member.username))
        .map(member => ({ username: member.username })) : [];
      return { teams: [], members };
    }
    const orgTeams = await giteaService.listTeams(skill.scope);
    const mountedTeams = await giteaService.listRepoTeams(repo.owner, repo.name);
    const grantedTeams = new Set(buildLogicalTeamViews(mountedTeams, orgTeams,
      skillTeamGrantRepository.list(skill.name), tenantOrganizationRepository, skill.scope).map(team => team.id));
    const teams = orgTeams.filter(team => team.name.endsWith('-read')).flatMap(team => {
      const name = team.name.slice(0, -'-read'.length);
      if (grantedTeams.has(team.id) || !hasLogicalTeamProjection(orgTeams, name)) return [];
      const display_name = tenantOrganizationRepository.getTeamDisplayName(skill.scope, team.id);
      if (query && !`${name} ${display_name ?? ''}`.toLowerCase().includes(query.toLowerCase())) return [];
      return [{ id: team.id, name, display_name }];
    });
    const members = (await giteaService.listOrgMembers(skill.scope))
      .filter(member => !grantedMembers.has(member.username) && member.username.toLowerCase().includes(query.toLowerCase()))
      .map(member => ({ username: member.username }));
    return { teams, members };
  });

  // 同一技能的授权变更按顺序执行，避免并发新增覆盖已有权限。
  const permissionChanges = new Map<string, Promise<void>>();
  app.post('/api/skills/:scope/:skillName/permissions', async (request, reply) => {
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      return reply.status(401).send(apiError('unauthorizedInvalidToken'));
    }
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const skill = repository.getSkill(name);
    if (!skill) {
      return reply.status(404).send(apiError('skillNotFound'));
    }
    const previous = permissionChanges.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    permissionChanges.set(name, current);
    await previous;
    try {
      if (!(await canManageSkill(giteaService, skill, user.username))) {
        return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
      }

      const body = request.body as {
        action?: string;
        team?: string;
        team_id?: number;
        username?: string;
        permission?: string;
        mode?: 'create' | 'edit';
      };
      if (body.mode !== undefined && body.mode !== 'create' && body.mode !== 'edit') {
        return reply.status(400).send(apiError('validationFailed', { detail: 'mode must be create or edit' }));
      }
      // 未携带 mode 的既有 CLI 请求保留幂等设置语义；Web 显式区分新增和编辑。
      // ADR-0064:组织级授权动作先于参数校验显式拒绝,不再落进 listTeams 的
      // defaultTeamNotFound 404——错误语义是「此处没有组织」,而非「团队未配置」。
      if (ORG_LEVEL_PERMISSION_ACTIONS.has(body.action ?? '') && !isOrgNamespace(skill.scope)) {
        return reply.status(409).send(apiError('personalNamespaceNoOrgSharing'));
      }
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
            return reply.status(404).send(apiError('defaultTeamNotFound', { teamName }));
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
            return reply.status(404).send(apiError('teamNotFoundInOrganization'));
          }
          if (!hasLogicalTeamProjection(teams, logicalName)) {
            return reply.status(400).send(apiError('teamIsNotALogicalCustomTeam'));
          }
          if (body.action === 'set_team' &&
              body.permission !== 'read' &&
              body.permission !== 'write' &&
              body.permission !== 'manage') {
            return reply.status(400).send(apiError('teamPermissionMustBeReadWriteOrManage'));
          }
          if (body.action === 'set_team' && body.mode) {
            const granted = buildLogicalTeamViews(await giteaService.listRepoTeams(repo.owner, repo.name), teams,
              skillTeamGrantRepository.list(skill.name), tenantOrganizationRepository, skill.scope)
              .some(team => team.id === readTeam.id);
            if (body.mode === 'create' && granted) return reply.status(409).send(apiError('skillGrantAlreadyExists'));
            if (body.mode === 'edit' && !granted) return reply.status(409).send(apiError('skillGrantNoLongerExists'));
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
            return reply.status(400).send(apiError('usernameAndAReadWriteOrManagePermissionAreRequired'));
          }
          if (isOrgNamespace(skill.scope)) {
            if (!(await giteaService.listOrgMembers(skill.scope)).some(member => member.username === body.username)) {
              return reply.status(400).send(apiError('skillMemberMustBelongToOrganization'));
            }
          } else {
            const target = (await giteaService.listUsers()).find(member => member.username === body.username);
            if (!target || !isEnabledMember(target)) return reply.status(400).send(apiError('skillMemberNotEnabled'));
          }
          if (body.mode) {
            const granted = (await giteaService.listCollaborators(repo.owner, repo.name)).some(member => member.username === body.username);
            if (body.mode === 'create' && granted) return reply.status(409).send(apiError('skillGrantAlreadyExists'));
            if (body.mode === 'edit' && !granted) return reply.status(409).send(apiError('skillGrantNoLongerExists'));
          }
          payload = { skillName: name, scope: skill.scope, repoOwner: repo.owner, repoName: repo.name, action: body.action, username: body.username, permission: body.permission };
          break;
        }
        case 'remove_member': {
          if (!body.username) {
            return reply.status(400).send(apiError('usernameIsRequired'));
          }
          payload = { skillName: name, scope: skill.scope, repoOwner: repo.owner, repoName: repo.name, action: body.action, username: body.username };
          break;
        }
        case 'reset_to_private': {
          payload = { skillName: name, scope: skill.scope, repoOwner: repo.owner, repoName: repo.name, action: body.action };
          break;
        }
        default:
          return reply.status(400).send(apiError('unknownPermissionAction'));
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
            if (!selected) return reply.status(409).send(apiError('logicalTeamProjectionIsIncomplete'));
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
            return reply.status(400).send(apiError('unknownPermissionAction'));
        }
      } catch (error) {
        return reply.status(409).send({
          ...apiError('internalError', { detail: (error as Error).message ?? 'Permission change failed' }),
          retryable: true
        });
      }
      return await buildPermissionsResponse(skill, user.username);
    } finally {
      release();
      if (permissionChanges.get(name) === current) permissionChanges.delete(name);
    }
  });

  app.post('/api/skills/:scope/:skillName/rename', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string };
    const currentName = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(currentName);
    const nextShortName = (request.body as { name?: string }).name ?? '';
    if (!user || !skill || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    if (!/^[a-z0-9-]{1,64}$/.test(nextShortName)) {
      return reply.status(400).send(apiError('skillNameMustUseLowercaseLettersDigitsAndHyphens'));
    }
    const repo = skillRepo(skill);
    const nextName = `@${skill.scope}/${nextShortName}`;
    if (repository.getSkill(nextName)) {
      return reply.status(409).send(apiError('skillNameAlreadyExists'));
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
        ...apiError('skillRenameFailed', { detail: (error as Error).message }),
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
      return reply.status(404).send(apiError('skillNotFound'));
    }
    if (typeof giteaService.addCollaborator === 'function') {
      try {
        const repo = skillRepo(skill);
        await giteaService.addCollaborator(repo.owner, repo.name, user.username, 'read');
      } catch (error) {
        return reply.status(409).send(apiError('internalError', { detail: (error as Error).message }));
      }
    }
    return reply.send(withCloneUrl(request, skill));
  });

  app.post('/api/skills/:scope/:skillName/releases', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const startedAt = Date.now();
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(name);
    // 发布是长流程且失败分支多，统一走 fail()：保证每条拒绝路径都只记一条业务
    // 事件，且 errorCode 与响应体一致（ADR-0045 的「同一次异常只记录一次」）。
    const fail = (
      status: number,
      code: ApiErrorCode,
      errorParams: Record<string, string> = {}
    ): ReturnType<FastifyReply['send']> => {
      logSkillEvent(request, {
        event: 'skill.published',
        outcome: 'failed',
        message: 'Skill release publish rejected',
        actorUsername: user?.username ?? '',
        // 拿不到技能记录时退回请求路径里的 scope，至少保留组织维度可供检索。
        scope: skill?.scope ?? decodeURIComponent(params.scope ?? ''),
        name,
        skillId: skill?.skillId,
        errorCode: code,
        durationMs: Date.now() - startedAt
      });
      return reply.status(status).send(apiError(code, errorParams));
    };
    if (!user || !skill || !(await canManageSkill(giteaService, skill, user.username))) {
      return fail(403, 'forbiddenManagePermissionRequired');
    }
    if (skill.status === 'archived') {
      return fail(409, 'archivedSkillsCannotCreateReleases');
    }

    const body = request.body as {
      version?: string;
      sourceCommit?: string;
      releaseManifest?: unknown;
      files?: Record<string, string>;
      notes?: string;
      dryRun?: boolean;
    };
    if (!body.version || !semver.valid(body.version)) {
      return fail(400, 'releaseVersionMustBeValidSemver');
    }
    if (!body.sourceCommit) {
      return fail(400, 'sourcecommitIsRequired');
    }
    const repo = skillRepo(skill);
    let sourceFiles: Record<string, string>;
    if (typeof giteaService.readSourceTree === 'function') {
      try {
        sourceFiles = await giteaService.readSourceTree(repo.owner, repo.name, body.sourceCommit);
      } catch (error) {
        // dry-run 不 push 源码：本地 commit 服务器读不到时，退回请求体自带文件。
        if (!(body.dryRun && body.files)) throw error;
        sourceFiles = body.files;
      }
    } else {
      sourceFiles = body.files ?? {};
    }
    let sourceManifest: unknown = body.releaseManifest;
    if (sourceFiles['release.json']) {
      try {
        sourceManifest = JSON.parse(sourceFiles['release.json']);
      } catch {
        return fail(400, 'releaseJsonIsNotValidJson');
      }
    }
    const manifest = validateReleaseManifest(sourceManifest);
    if (!manifest.success) {
      return fail(400, 'validationFailed', { detail: manifest.errors.join(', ') });
    }
    // ADR-0032:publish 只断言归属——release.json 的 name 必须与技能既定身份
    // 一致(裸名按发布者个人命名空间补全),不一致即拒绝,归属变更不得借发布顺车。
    const manifestIdentity = parseSkillIdentity(manifest.data.name);
    const manifestScope = manifestIdentity?.scope ?? user.username;
    if (
      !manifestIdentity ||
      `@${manifestScope}/${manifestIdentity.shortName}` !== skill.name
    ) {
      // 这条拒绝的响应体多带两个字段，不能走 fail()，但事件与错误码保持一致。
      logSkillEvent(request, {
        event: 'skill.published',
        outcome: 'failed',
        message: 'Skill release publish rejected',
        actorUsername: user.username,
        scope: skill.scope,
        name,
        skillId: skill.skillId,
        errorCode: 'releaseManifestNameMismatch',
        durationMs: Date.now() - startedAt
      });
      return reply.status(409).send({
        ...apiError('releaseManifestNameMismatch', {
          manifestName: String(manifest.data.name),
          skillName: skill.name
        })
      });
    }
    if (!skill.skillId) {
      return fail(409, 'skillHasNoSkillId');
    }
    // Tombstones included on purpose: deleting a release burns its version number.
    if (repository.getRelease(name, body.version, { includeDeleted: true })) {
      return fail(409, 'skillReleaseAlreadyExists', { version: body.version });
    }
    const releaseTag = `v${body.version}`;
    let existingReleaseTag: { target: string } | null = null;
    if (typeof giteaService.getReleaseTag === 'function') {
      existingReleaseTag = await giteaService.getReleaseTag(repo.owner, repo.name, releaseTag);
      if (existingReleaseTag && existingReleaseTag.target !== body.sourceCommit) {
        return fail(409, 'releaseTagPointsElsewhere', {
          tag: releaseTag,
          target: existingReleaseTag.target,
          expected: body.sourceCommit
        });
      }
    }

    // ADR-0056：发布冻锁从根清单展开整图——范围交集、重选再展开、环、发布者
    // 可读与 Public 根全链 Public 都在这里权威校验；失败用稳定 API Error Code。
    let dependencyLock: Record<string, ReleaseLockEntry>;
    try {
      dependencyLock = await resolveReleaseGraph(
        manifest.data.dependencies,
        new ServerReleaseGraphSource(repository, giteaService, user.username),
        {
          rootVisibility: skill.visibility === 'private' ? 'private' : 'public',
          rootIdentity: name
        }
      );
    } catch (error) {
      if (error instanceof ReleaseGraphError) {
        return fail(releaseGraphErrorStatus(error.code), error.code, error.errorParams);
      }
      throw error;
    }

    if (body.dryRun) {
      return reply.status(200).send({
        dryRun: true,
        name,
        version: body.version,
        sourceCommit: body.sourceCommit,
        dependencyLock
      });
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
        return fail(409, 'skillReleaseAlreadyExists', { version: body.version });
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
    logSkillEvent(request, {
      event: 'skill.published',
      outcome: 'succeeded',
      message: 'Skill release published',
      actorUsername: user.username,
      scope: skill.scope,
      name,
      skillId: skill.skillId,
      durationMs: Date.now() - startedAt
    });
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
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    const release = repository.getRelease(name, decodeURIComponent(params.version));
    if (!release) {
      return reply.status(404).send(apiError('skillReleaseNotFound'));
    }
    if (typeof giteaService.getReleaseTag !== 'function') {
      return reply.status(501).send(apiError('releaseTagRepairIsNotSupportedByTheGitBackend'));
    }

    const tag = `v${release.version}`;
    const repo = skillRepo(skill);
    const existing = await giteaService.getReleaseTag(repo.owner, repo.name, tag);
    if (existing) {
      if (existing.target !== release.sourceCommit) {
        return reply.status(409).send({
          ...apiError('releaseTagPointsElsewhere', {
            tag,
            target: existing.target,
            expected: release.sourceCommit
          })
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
      return reply.status(409).send(apiError('internalError', { detail: (error as Error).message }));
    }
    return reply.send({
      repaired: true,
      tag,
      sourceCommit: release.sourceCommit
    });
  });

  app.get('/api/packages/:skillId/:version/:checksum', async (request, reply) => {
    const params = request.params as { skillId: string; version: string; checksum: string };
    const pathValid = [params.skillId, params.version, params.checksum].every((value) =>
      /^[A-Za-z0-9._-]+$/.test(value)
    );
    // 失败的发放尝试同样留明细（失败模式可观测），但失败行不计数。路径不合法时
    // 连目标技能都无法确定，不为它写行；failure_reason 用响应体里的 API Error
    // Code，使客户端看到的拒绝与服务端日志可直接关联（ADR-0045）。
    const logFailure = (
      failureReason: ApiErrorCode,
      input: {
        skillId?: string | null;
        skillIdentity?: string | null;
        version?: string | null;
        user?: { username: string; id?: string } | null;
      } = {}
    ): void => {
      if (!pathValid) return;
      recordDownload(request, {
        skillId: input.skillId ?? params.skillId,
        skillIdentity: input.skillIdentity ?? null,
        version: input.version ?? params.version,
        user: input.user ?? null,
        result: 'failure',
        failureReason
      });
    };

    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!user) {
      logFailure('unauthorizedInvalidToken');
      return reply.status(401).send(apiError('unauthorizedInvalidToken'));
    }
    if (!pathValid) {
      return reply.status(400).send(apiError('invalidPublishedSkillPackagePath'));
    }
    const skill = repository.getSkillById(params.skillId);
    if (!skill) {
      logFailure('skillNotFound', { user });
      return reply.status(404).send(apiError('skillNotFound'));
    }
    if (!(await hasReadAccess(giteaService, skill, user.username))) {
      logFailure('forbiddenNoAccessToThisPrivateSkillRequestAccessFromItsMaintainers', {
        skillId: skill.skillId,
        skillIdentity: skill.name,
        user
      });
      return reply.status(403).send(apiError('forbiddenNoAccessToThisPrivateSkillRequestAccessFromItsMaintainers'));
    }
    const packagePath = path.join(packageRoot, params.skillId, params.version, params.checksum);
    try {
      const bytes = await fs.readFile(packagePath);
      recordDownload(request, {
        skillId: skill.skillId,
        skillIdentity: skill.name,
        version: params.version,
        user,
        result: 'success'
      });
      return reply.type('application/json').send(bytes);
    } catch {
      logFailure('publishedSkillPackageNotFound', {
        skillId: skill.skillId,
        skillIdentity: skill.name,
        user
      });
      return reply.status(404).send(apiError('publishedSkillPackageNotFound'));
    }
  });

  app.post('/api/skills/:scope/:skillName/releases/:version/notes', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string; version: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(name);
    if (!user || !skill || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    const version = decodeURIComponent(params.version);
    const body = request.body as { message?: string };
    if (typeof body.message !== 'string') {
      return reply.status(400).send(apiError('releaseNotesMessageIsRequired'));
    }
    const updated = repository.updateReleaseNotes(name, version, body.message);
    if (!updated) {
      return reply.status(404).send(apiError('skillReleaseNotFound'));
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
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    const body = (request.body ?? {}) as { confirm?: string; force?: boolean };
    if (body.confirm !== version) {
      return reply.status(400).send(apiError('deletionRequiresConfirmMatchingTheReleaseVersion'));
    }
    const release = repository.getRelease(name, version);
    if (!release || !skill.skillId) {
      return reply.status(404).send(apiError('skillReleaseNotFound'));
    }
    const dependents = repository.findDependentReleases(skill.skillId, version);
    if (dependents.length > 0) {
      if (!body.force) {
        return reply.status(409).send({
          ...apiError('releaseRequiredByDependents', { version, dependents: dependents.join(', ') })
        });
      }
      if (!(await authorizePlatformAdministrator(request, adminRepository, giteaService))) {
        return reply.status(403).send({
          ...apiError('forbiddenForcingPastAPinnedDependencyRequiresAPlatformAdministrator')
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
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    if (skill.status === 'archived') {
      return reply.status(409).send(apiError('archivedSkillsDoNotAcceptReleaseChanges'));
    }
    const body = request.body as { message?: string };
    if (body.message !== undefined && typeof body.message !== 'string') {
      return reply.status(400).send(apiError('deprecationMessageMustBeAString'));
    }
    const updated = repository.setReleaseDeprecation(
      name,
      decodeURIComponent(params.version),
      body.message ?? ''
    );
    if (!updated) {
      return reply.status(404).send(apiError('skillReleaseNotFound'));
    }
    return reply.send(updated);
  });

  app.post('/api/skills/:scope/:skillName/archive', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(name);
    if (!user || !skill || !(await canManageSkill(giteaService, skill, user.username))) {
      return reply.status(403).send(apiError('forbiddenManagePermissionRequired'));
    }
    if (typeof giteaService.setRepositoryArchived === 'function') {
      try {
        const repo = skillRepo(skill);
        await giteaService.setRepositoryArchived(repo.owner, repo.name, true);
      } catch (error) {
        return reply.status(409).send(apiError('internalError', { detail: (error as Error).message }));
      }
    }
    repository.archiveSkill(name);
    return reply.send(repository.getSkill(name));
  });

  app.post('/api/skills/:scope/:skillName/restore', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(name);
    if (!user || !skill) return reply.status(404).send(apiError('skillNotFound'));
    const platformAdmin = Boolean(
      await authorizePlatformAdministrator(request, adminRepository, giteaService)
    );
    if (!(await canRestoreSkill(skill, user.username, platformAdmin))) {
      return reply.status(403).send(apiError('forbiddenRestorePermissionRequired'));
    }
    if (skill.status !== 'archived') {
      return reply.status(409).send(apiError('onlyArchivedSkillsCanBeRestored'));
    }
    if (typeof giteaService.setRepositoryArchived === 'function') {
      try {
        const repo = skillRepo(skill);
        await giteaService.setRepositoryArchived(repo.owner, repo.name, false);
      } catch (error) {
        return reply.status(409).send(apiError('internalError', { detail: (error as Error).message }));
      }
    }
    repository.restoreSkill(name, repository.hasEverPublished(name));
    return reply.send(repository.getSkill(name));
  });

  // 删除前 Web 需要完整风险上下文：依赖方不阻断删除，但必须先展示并进入审计。
  app.get('/api/skills/:scope/:skillName/delete-context', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(name);
    if (!user || !skill) return reply.status(404).send(apiError('skillNotFound'));
    const platformAdmin = Boolean(
      await authorizePlatformAdministrator(request, adminRepository, giteaService)
    );
    if (!(await canDeleteWholeSkill(skill, user.username, platformAdmin))) {
      return reply.status(403).send(apiError('forbiddenDeletePermissionRequired'));
    }
    const skillId = skill.skillId ?? '';
    const releasesRemoved = (repository as SkillRepository).getReleases(skill.name).length;
    return reply.send({
      name,
      everPublished: repository.hasEverPublished(name),
      releasesRemoved,
      dependents: skillId ? repository.findSkillDependents(skillId) : []
    });
  });

  app.post('/api/skills/:scope/:skillName/delete', async (request, reply) => {
    const params = request.params as { scope: string; skillName: string };
    const name = `${decodeURIComponent(params.scope).startsWith('@') ? '' : '@'}${decodeURIComponent(params.scope)}/${decodeURIComponent(params.skillName)}`;
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    const skill = repository.getSkill(name);
    if (!user || !skill) return reply.status(404).send(apiError('skillNotFound'));
    const platformAdmin = Boolean(
      await authorizePlatformAdministrator(request, adminRepository, giteaService)
    );
    if (!(await canDeleteWholeSkill(skill, user.username, platformAdmin))) {
      return reply.status(403).send(apiError('forbiddenDeletePermissionRequired'));
    }
    if (skill.status !== 'archived' && skill.status !== 'delete_failed') {
      return reply.status(409).send(apiError('skillMustBeArchivedBeforeDeletion'));
    }
    const body = (request.body ?? {}) as { confirm?: string; reason?: string };
    const reason = body.reason?.trim() ?? '';
    if (!reason) {
      return reply.status(400).send(apiError('deletionRequiresANonEmptyReason'));
    }
    if (body.confirm !== name) {
      return reply.status(400).send(apiError('deletionRequiresConfirmMatchingTheSkillIdentity'));
    }

    // 两阶段删除的第二个阶段必须可重试。进入 deleting 后，任何外部资产失败都
    // 保留技能记录并落到 delete_failed；Web 可以带着同一原因重试。
    repository.beginSkillDeletion({ name, requestedBy: user.username, reason });
    const repo = skillRepo(skill);
    if (typeof giteaService.deleteRepo === 'function') {
      try {
        await giteaService.deleteRepo(repo.owner, repo.name);
      } catch (error) {
        const message = `Failed to delete Git repository: ${(error as Error).message}`;
        repository.markSkillDeletionFailed(name, message);
        return reply.status(409).send(apiError('internalError', { detail: message }));
      }
    }
    try {
      if (skill.skillId) {
        await fs.rm(path.join(packageRoot, skill.skillId), { recursive: true, force: true });
      }
    } catch (error) {
      const message = `Failed to delete published packages: ${(error as Error).message}`;
      repository.markSkillDeletionFailed(name, message);
      return reply.status(409).send(apiError('internalError', { detail: message }));
    }
    const deleted = repository.deleteSkillWithAudit({
      fullName: name,
      deletedBy: user.username,
      reason,
      dependents: skill.skillId ? repository.findSkillDependents(skill.skillId) : []
    });
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
        ...apiError('skillRenamed'),
        oldName: name,
        currentName: redirect.currentName,
        skillId: redirect.skillId
      });
    }
    if (!skill) {
      return reply.status(404).send(apiError('skillNotFound'));
    }
    const user = await authenticateSkillUser(request, adminRepository, giteaService);
    if (!(await hasReadAccess(giteaService, skill, user?.username))) {
      return reply.status(403).send(apiError('forbiddenNoAccessToThisPrivateSkillRequestAccessFromItsMaintainers'));
    }

    const releases = repository.getReleases(name);
    const latest = newestStableRelease(releases);
    // 下载量口径（ADR-0067）：顶层 downloadCount 是跨版本汇总的总量；各版本
    // 计数挂在 releases 上。versions 保持字符串数组不变——它是 CLI 选择安装
    // 版本的输入，改成对象会破坏既有客户端的安装路径。
    const versionDownloadCounts = skill.skillId
      ? downloadLogRepository?.getVersionDownloadCounts(skill.skillId) ?? {}
      : {};
    return withCloneUrl(request, {
      ...skill,
      displayName: resolveSkillDisplayName(repository, skill),
      versions: sortVersionsDescending(repository.getVersions(name)),
      downloadCount: skill.skillId ? downloadLogRepository?.getSkillDownloadCount(skill.skillId) ?? 0 : 0,
      releases: releases.map((release) => ({
        ...release,
        deprecatedMessage: release.deprecatedMessage ?? null,
        downloadCount: versionDownloadCounts[release.version] ?? 0,
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

// 目录显示名（ADR-0048）：有发布时取最近 Release 快照的 displayName，
// 缺失或为空回退 Identity 短名。运行时不做 Title Case，保持用户原文。
function searchDisplayName(releaseManifest: unknown, fallback: string): string {
  const displayName = (releaseManifest as { displayName?: unknown }).displayName;
  return typeof displayName === 'string' && displayName.trim() ? displayName : fallback;
}
// releaseGraphErrorStatus（图解析失败码 → HTTP 状态）由 @esl/core 提供，server
// 与 CLI 共用同一映射。

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

function isEnabledMember(member: GiteaAdminUser): boolean {
  return member.active && !member.prohibit_login;
}

function hasLogicalTeamProjection(teams: GiteaTeam[], name: string): boolean {
  return (['read', 'write', 'manage'] as const).every(permission =>
    teams.some(team => team.name === backendTeamName(name, permission)));
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

// 技能显示名解析（ADR-0048）：消费面与管理面标题共用同一规则——
// 1) 曾发布 → 取最近一次 Skill Release（按发布时间，含预发布）快照的 displayName；
//    字段缺失或为空 → 回退 Identity 短名（不读 upload 脏值）；
// 2) 从未发布（active-unreleased）→ 取 upload 同步到服务器的当前源码 displayName；
// 3) 仍未设置 → Identity 短名原文（运行时不做 Title Case）。
function resolveSkillDisplayName(repository: SkillRepository, skill: SkillRecord): string {
  const releases = repository.getReleases(skill.name);
  if (releases.length > 0) {
    const manifest = releases[0].releaseManifest as { displayName?: unknown };
    if (typeof manifest.displayName === 'string' && manifest.displayName.length > 0) {
      return manifest.displayName;
    }
    return parseSkillIdentity(skill.name)?.shortName ?? skill.name;
  }
  if (skill.displayName) return skill.displayName;
  return parseSkillIdentity(skill.name)?.shortName ?? skill.name;
}

// 技能管理页面的只读上下文块(CONTEXT:技能管理页面):描述、发布状态与完整
// Skill Release 列表。latestRelease 取最高稳定版本,与 CLI 的默认解析一致。
function buildSkillContext(
  repository: SkillRepository,
  skill: SkillRecord,
  downloadLogRepository?: DownloadLogRepository
) {
  const releases = repository.getReleases(skill.name);
  const everPublished = repository.hasEverPublished(skill.name);
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
    displayName: resolveSkillDisplayName(repository, skill),
    description: skill.description,
    // 逐技能可见性（ADR-0032/0062）：管理页的可见性区块与 CLI 的
    // `esl skill share`（查看矩阵）都从这里读，缺了就只能显示兜底值。
    visibility: skill.visibility,
    status: skill.status,
    everPublished,
    deletionError: skill.deletionError ?? null,
    createdBy: skill.createdBy,
    // 公开下载量（ADR-0067）：跨版本总量随技能上下文一并下发，管理面板据此
    // 展示使用规模，不必再发一次技能清单请求去取一个数字。
    downloadCount: skill.skillId
      ? downloadLogRepository?.getSkillDownloadCount(skill.skillId) ?? 0
      : 0,
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
  // 测试或精简 Git Backend 可能不提供管理员 token 校验；按 fail closed 处理。
  if (typeof giteaService.validateAdminUserToken !== 'function') return false;
  return (await giteaService.validateAdminUserToken(token)) !== null;
}

async function authenticateSkillUser(
  request: FastifyRequest,
  adminRepository: AdminRepository | undefined,
  giteaService: GiteaService
): Promise<{ username: string; id?: string } | null> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) return null;
  const token = authorization.replace('token ', '').trim();
  const eslUser = adminRepository?.validateUserToken(token);
  if (eslUser) return eslUser;
  if (adminRepository?.hasIssuedToken(token) || token.startsWith('esl_')) return null;
  const user = await giteaService.validateToken(token);
  // Git Backend 的数值型用户 id 稳定且不随改名变化，适合作为下载日志的
  // user_id；ESL 原生 token 没有独立数值 id，此时 user_id 留空。
  if (!user) return null;
  return typeof user.id === 'number'
    ? { username: user.username, id: String(user.id) }
    : { username: user.username };
}

// 客户端 IP 取自可信代理头（部署拓扑为 nginx 前置），无代理头时回退连接地址；
// 结果交给 truncateClientIp 截断后才落库（ADR-0067）。
//
// 取最后一个 hop 而非第一个：nginx 用 $proxy_add_x_forwarded_for 追加，落到后端
// 的头形如「客户端自带的 X-Forwarded-For, nginx 看到的 $remote_addr」。取第一个
// 等于采信调用方自带的头，下载方就能伪造来源网段——而来源网段正是超管排查滥用
// 时依赖的字段。最后一个才是本拓扑下唯一由我们自己的代理写入的值。
function clientIpOf(request: FastifyRequest): string | undefined {
  const forwarded = request.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  const hops = raw
    ?.split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);
  return hops && hops.length > 0 ? hops[hops.length - 1] : request.ip;
}

// 组织命名空间的技能仓库创建时是私有的，只挂组织 owners 团队，而 ADR-0032
// 允许任何组织成员 upload。创建者在 API 权限层被视为 owner/manage，但 Gitea
// 不会因此自动获得私有仓库访问权，必须显式授权为协作者（manage 档映射为
// admin 级，ADR-0025）。个人命名空间的仓库 owner 就是上传者本人，无需授权。
async function ensureSourceCreatorGitAccess(
  giteaService: GiteaService,
  scope: string,
  shortName: string,
  username: string
): Promise<void> {
  if (scope === username || typeof giteaService.addCollaborator !== 'function') return;
  await giteaService.addCollaborator(scope, shortName, username, 'admin');
}

// 技能列表类的下载量富化（ADR-0067）：搜索面与技能清单共用同一口径。skillId
// 只是内部分组键，不进入响应契约；无记录或无 skillId 的技能计 0，使"没下载过"
// 与"字段缺失"对客户端是同一件事。
function withDownloadCounts<T extends { skillId?: string }>(
  rows: readonly T[],
  repository: DownloadLogRepository | undefined
): Array<Omit<T, 'skillId'> & { downloadCount: number }> {
  const counts = repository?.getSkillDownloadCounts(
    rows.map((row) => row.skillId).filter((id): id is string => Boolean(id))
  );
  return rows.map(({ skillId, ...row }) => ({
    ...(row as Omit<T, 'skillId'>),
    downloadCount: (skillId && counts?.get(skillId)) || 0
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
