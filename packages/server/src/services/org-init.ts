import type { GiteaService } from './gitea.js';
import type { TenantOrganizationRepository } from '../db/database.js';
import { DEFAULT_TEAM_DISPLAY_NAMES } from './org-team-model.js';

export async function initializeTenantOrganization(
  giteaService: GiteaService,
  orgName: string,
  adminPassword: string,
  tenantOrganizationRepository: TenantOrganizationRepository
): Promise<void> {
  const adminUsername = `${orgName}_admin`;
  let orgPreExisted = false;
  if (!(await giteaService.organizationExists(orgName))) {
    await giteaService.createOrg(orgName);
  } else {
    orgPreExisted = true;
  }
  const members = await giteaService.listOrgMembers(orgName);
  const teams = await giteaService.listTeams(orgName);
  // 新建组织时 Gitea 会自动创建一个 Owners 常驻团队，其 permission 恒为 "owner"。
  const ownersTeam = teams.find((team) => team.permission === 'owner' || team.permission === 'admin');
  if (!ownersTeam) {
    throw new Error(`Gitea organization has no Owners team: ${orgName}`);
  }
  // 已存在的组织必须验证归属:Owners 团队中出现本组织管理员以外的成员,
  // 说明该组织并非本流程创建,不能盲目接管(结构化错误进入脱敏管线)。
  // 平台 site admin 例外:Gitea 创建组织时会把 admin token 持有者自动加入
  // Owners,它是 ESL 侧的系统账号,不构成外部所有者。
  if (orgPreExisted) {
    const ownerMembers = await giteaService.listTeamMembers(ownersTeam.id);
    const foreignOwners = ownerMembers.filter(
      (member) => member.username !== adminUsername && member.username !== giteaService.adminUsername
    );
    if (foreignOwners.length > 0) {
      throw {
        code: 'EXTERNAL_RESOURCE',
        message: `Organization already exists with external owners (${foreignOwners.map((member) => member.username).join(', ')})`,
        details: {
          resources: foreignOwners.map((member) => `owner ${member.username}`)
        }
      };
    }
  }
  if (!members.some((member) => member.username === adminUsername)) {
    await giteaService.createUser(adminUsername, adminPassword);
  }
  if (!members.some((member) => member.username === adminUsername)) {
    await giteaService.addTeamMember(ownersTeam.id, adminUsername);
  }
  if (!teams.some((team) => team.name === 'all-readers')) {
    await giteaService.createTeam(orgName, 'all-readers', 'read');
  }
  if (!teams.some((team) => team.name === 'all-writers')) {
    await giteaService.createTeam(orgName, 'all-writers', 'write');
  }
  if (!teams.some((team) => team.name === 'all-managers')) {
    await giteaService.createTeam(orgName, 'all-managers', 'admin');
  }
  // 系统管理团队(ADR-0026):ESL 层的组织管理权委托载体,独立于 Gitea Owners
  // 团队——全部仓库的结构性 admin 授权与建库权。admin 账号自动加入且不可
  // 移出;重试时团队已存在则只补成员,幂等。
  let systemAdminsTeam = teams.find((team) => team.name === 'system-admins');
  if (!systemAdminsTeam) {
    systemAdminsTeam = await giteaService.createTeam(orgName, 'system-admins', 'admin', {
      includesAllRepositories: true,
      canCreateOrgRepo: true
    });
  }
  const systemAdminsMembers = await giteaService.listTeamMembers(systemAdminsTeam.id);
  if (!systemAdminsMembers.some((member) => member.username === adminUsername)) {
    await giteaService.addTeamMember(systemAdminsTeam.id, adminUsername);
  }
  // ADR-0029:默认团队显示名为平台预置数据,组织初始化时播种,幂等
  // (已存在则跳过);存量组织的回填由团队列表读时惰性播种兜底。
  if (
    tenantOrganizationRepository.getTeamDisplayName(orgName, systemAdminsTeam.id) === undefined &&
    DEFAULT_TEAM_DISPLAY_NAMES[systemAdminsTeam.name] !== undefined
  ) {
    tenantOrganizationRepository.setTeamDisplayName(
      orgName,
      systemAdminsTeam.id,
      DEFAULT_TEAM_DISPLAY_NAMES[systemAdminsTeam.name]
    );
  }
  // Gitea 用 admin token 创建组织时会把 site admin 自动加入 Owners 团队;
  // 平台系统账号不属于组织治理面,初始化完成后移出,保持 Owners 只含本组织
  // 管理员。重试时若已移除(listTeamMembers 不含 site admin)则跳过,幂等。
  if (giteaService.adminUsername && typeof giteaService.removeTeamMember === 'function') {
    const owners = await giteaService.listTeamMembers(ownersTeam.id);
    if (owners.some((member) => member.username === giteaService.adminUsername)) {
      await giteaService.removeTeamMember(ownersTeam.id, giteaService.adminUsername);
    }
  }
}
