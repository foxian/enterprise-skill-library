import type { GiteaService } from './gitea.js';

export async function initializeTenantOrganization(
  giteaService: GiteaService,
  orgName: string,
  adminPassword: string
): Promise<void> {
  if (!(await giteaService.organizationExists(orgName))) {
    await giteaService.createOrg(orgName);
  }
  const adminUsername = `${orgName}_admin`;
  const members = await giteaService.listOrgMembers(orgName);
  if (!members.some((member) => member.username === adminUsername)) {
    await giteaService.createUser(adminUsername, adminPassword);
  }
  const teams = await giteaService.listTeams(orgName);
  // 新建组织时 Gitea 会自动创建一个 Owners 常驻团队，其 permission 恒为 "owner"。
  const ownersTeam = teams.find((team) => team.permission === 'owner' || team.permission === 'admin');
  if (!ownersTeam) {
    throw new Error(`Gitea organization has no Owners team: ${orgName}`);
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
