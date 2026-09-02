import type { GiteaService } from './gitea.js';

export async function initializeTenantOrganization(
  giteaService: GiteaService,
  orgName: string,
  adminPassword: string
): Promise<void> {
  await giteaService.createOrg(orgName);
  const adminUsername = `${orgName}_admin`;
  await giteaService.createUser(adminUsername, adminPassword);
  const teams = await giteaService.listTeams(orgName);
  // 新建组织时 Gitea 会自动创建一个 Owners 常驻团队，其 permission 恒为 "owner"。
  const ownersTeam = teams.find((team) => team.permission === 'owner' || team.permission === 'admin');
  if (!ownersTeam) {
    throw new Error(`Gitea organization has no Owners team: ${orgName}`);
  }
  await giteaService.addTeamMember(ownersTeam.id, adminUsername);
  await giteaService.createTeam(orgName, 'all-readers', 'read');
  await giteaService.createTeam(orgName, 'all-writers', 'write');
}
