import type { GiteaService } from './gitea.js';

export async function initializeTenantOrganization(
  giteaService: GiteaService,
  orgName: string,
  adminPassword: string
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
  if (orgPreExisted) {
    const ownerMembers = await giteaService.listTeamMembers(ownersTeam.id);
    const foreignOwners = ownerMembers.filter((member) => member.username !== adminUsername);
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
}
