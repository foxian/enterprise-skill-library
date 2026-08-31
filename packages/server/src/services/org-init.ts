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
  const ownersTeam = teams.find((team) => team.permission === 'admin');
  if (!ownersTeam) {
    throw new Error(`Gitea organization has no Owners team: ${orgName}`);
  }
  await giteaService.addTeamMember(ownersTeam.id, adminUsername);
  await giteaService.createTeam(orgName, 'all-readers', 'read');
  await giteaService.createTeam(orgName, 'all-writers', 'write');
}
