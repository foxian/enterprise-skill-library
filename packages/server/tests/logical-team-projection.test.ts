import { describe, expect, it } from 'vitest';
import { ensureLogicalTeamProjection, syncLogicalTeamMembers } from '../src/services/logical-team-projection.js';
import { createGlobalGitea } from './helpers/global-gitea.js';

describe('logical team backend projection', () => {
  it('creates three permission teams and synchronizes the same members to each', async () => {
    const gitea = createGlobalGitea({ orgs: [{ name: 'acme', teams: [] }] });

    const projection = await ensureLogicalTeamProjection(gitea as any, 'acme', 'frontend', ['alice']);
    expect(Object.values(projection).map((team) => team.name).sort()).toEqual([
      'frontend-manage',
      'frontend-read',
      'frontend-write'
    ]);

    await syncLogicalTeamMembers(gitea as any, projection, ['bob']);
    for (const team of Object.values(projection)) {
      expect((await gitea.listTeamMembers(team.id)).map((member) => member.username)).toEqual(['bob']);
    }

    const second = await ensureLogicalTeamProjection(gitea as any, 'acme', 'frontend', ['bob']);
    expect(Object.fromEntries(Object.entries(second).map(([key, team]) => [key, team.id])))
      .toEqual(Object.fromEntries(Object.entries(projection).map(([key, team]) => [key, team.id])));
    expect((await gitea.listTeams('acme')).filter((team) => team.name.startsWith('frontend-'))).toHaveLength(3);
  });
});
