import type { GiteaService, GiteaTeam } from './gitea.js';

export type LogicalTeamPermission = 'read' | 'write' | 'manage';
export type LogicalTeamProjection = Record<LogicalTeamPermission, GiteaTeam>;

const PROJECTION_PERMISSIONS: LogicalTeamPermission[] = ['read', 'write', 'manage'];

export function backendTeamName(teamKey: string, permission: LogicalTeamPermission): string {
  return `${teamKey}-${permission}`;
}

export async function ensureLogicalTeamProjection(
  gitea: GiteaService,
  org: string,
  teamKey: string,
  members: string[]
): Promise<LogicalTeamProjection> {
  const teams = await gitea.listTeams(org);
  const projection = {} as LogicalTeamProjection;
  for (const permission of PROJECTION_PERMISSIONS) {
    const name = backendTeamName(teamKey, permission);
    let team = teams.find((candidate) => candidate.name === name);
    if (!team) {
      team = await gitea.createTeam(org, name, permission === 'manage' ? 'admin' : permission);
    }
    projection[permission] = team;
  }
  await syncLogicalTeamMembers(gitea, projection, members);
  return projection;
}

export async function syncLogicalTeamMembers(
  gitea: GiteaService,
  projection: LogicalTeamProjection,
  members: string[]
): Promise<void> {
  const expected = new Set(members);
  for (const team of Object.values(projection)) {
    const current = new Set((await gitea.listTeamMembers(team.id)).map((member) => member.username));
    for (const username of expected) {
      if (!current.has(username)) await gitea.addTeamMember(team.id, username);
    }
    for (const username of current) {
      if (!expected.has(username)) await gitea.removeTeamMember(team.id, username);
    }
  }
}

export async function deleteLogicalTeamProjection(
  gitea: GiteaService,
  projection: LogicalTeamProjection
): Promise<void> {
  for (const team of Object.values(projection)) {
    await gitea.deleteTeam(team.id);
  }
}
