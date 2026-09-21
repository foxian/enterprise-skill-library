import { describe, expect, it, vi } from 'vitest';
import type { SkillRecord } from '../src/db/database.js';
import { canManageSkill, getAccessLevel, hasReadAccess, skillRepo } from '../src/services/skill-access.js';

function skill(overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    name: '@acme/reviewer',
    scope: 'acme',
    skillName: 'reviewer',
    description: 'Reviewer skill',
    createdBy: 'acme_alice',
    owner: 'acme_alice',
    maintainers: ['acme_alice'],
    visibility: 'private',
    gitRepoPath: 'acme/reviewer',
    ...overrides
  };
}

function repoGitea(overrides: Record<string, unknown> = {}) {
  return {
    adminUsername: 'eslroot',
    listOrgOwners: async () => [],
    listTeams: async () => [],
    listRepoTeams: async () => [] as Array<{ id: number; name: string; permission: string }>,
    isTeamMember: async () => false,
    getCollaboratorPermission: async () => 'none',
    ...overrides
  };
}

describe('skill access level', () => {
  it('grants manage to the skill owner without consulting Git Backend teams', async () => {
    const gitea = {
      listRepoTeams: vi.fn(async () => {
        throw new Error('should not list teams for the owner');
      }),
      isTeamMember: vi.fn(),
      getCollaboratorPermission: vi.fn()
    };

    await expect(getAccessLevel(gitea as any, skill(), 'acme_alice')).resolves.toBe('manage');
    expect(gitea.listRepoTeams).not.toHaveBeenCalled();
  });

  it('grants manage to the initial maintainer even when they are not the owner', async () => {
    const gitea = {
      listRepoTeams: vi.fn(async () => {
        throw new Error('should not list teams for the initial maintainer');
      })
    };

    await expect(
      getAccessLevel(gitea as any, skill({ maintainers: ['acme_bob'] }), 'acme_bob')
    ).resolves.toBe('manage');
    expect(gitea.listRepoTeams).not.toHaveBeenCalled();
  });

  it('returns none for an anonymous caller before consulting Git Backend', async () => {
    const gitea = {
      listRepoTeams: vi.fn(async () => {
        throw new Error('should not list teams for an anonymous caller');
      })
    };

    await expect(getAccessLevel(gitea as any, skill(), undefined)).resolves.toBe('none');
    expect(gitea.listRepoTeams).not.toHaveBeenCalled();
  });

  it('grants manage to the super administrator without consulting teams', async () => {
    const gitea = {
      adminUsername: 'eslroot',
      listRepoTeams: vi.fn(async () => {
        throw new Error('should not list teams for the super administrator');
      })
    };

    await expect(getAccessLevel(gitea as any, skill(), 'eslroot')).resolves.toBe('manage');
    expect(gitea.listRepoTeams).not.toHaveBeenCalled();
  });

  it('grants manage to an organization owner member managing organization skills', async () => {
    const giteaOld = { listOrgOwners: vi.fn(async () => [{ id: 2, username: 'acme_manager', email: 'm@local.esl' }]) };
    const gitea = {
      ...giteaOld,
      listRepoTeams: vi.fn(async () => {
        throw new Error('should not need repo teams for an org manager');
      })
    };

    await expect(getAccessLevel(gitea as any, skill(), 'acme_manager')).resolves.toBe('manage');
    expect(gitea.listRepoTeams).not.toHaveBeenCalled();
  });

  it('keeps the legacy read baseline for backends without permission APIs', async () => {
    const gitea = { adminUsername: 'eslroot' };

    await expect(getAccessLevel(gitea as any, skill(), 'acme_bob')).resolves.toBe('read');
  });

  it('uses public visibility as a read baseline for authenticated non-members', async () => {
    const gitea = repoGitea();
    await expect(getAccessLevel(gitea as any, skill({ visibility: 'public' }), 'acme_bob')).resolves.toBe('read');
  });

  it('returns none for a private skill with no team or collaborator grants', async () => {
    const gitea = repoGitea();
    await expect(getAccessLevel(gitea as any, skill(), 'acme_bob')).resolves.toBe('none');
  });

  it('derives read from a read team', async () => {
    const gitea = repoGitea({
      listRepoTeams: async () => [{ id: 7, name: 'frontend-read', permission: 'read' }],
      isTeamMember: async () => true
    });
    await expect(getAccessLevel(gitea as any, skill(), 'acme_bob')).resolves.toBe('read');
  });

  it('derives write from a write team', async () => {
    const gitea = repoGitea({
      listRepoTeams: async () => [{ id: 8, name: 'frontend-write', permission: 'write' }],
      isTeamMember: async () => true
    });
    await expect(getAccessLevel(gitea as any, skill(), 'acme_bob')).resolves.toBe('write');
  });

  it('derives manage from an admin team', async () => {
    const gitea = repoGitea({
      listRepoTeams: async () => [{ id: 9, name: 'frontend-manage', permission: 'admin' }],
      isTeamMember: async () => true
    });
    await expect(getAccessLevel(gitea as any, skill(), 'acme_bob')).resolves.toBe('manage');
  });

  it('derives read from a read collaborator', async () => {
    const gitea = repoGitea({ getCollaboratorPermission: async () => 'read' });
    await expect(getAccessLevel(gitea as any, skill(), 'acme_bob')).resolves.toBe('read');
  });

  it('derives write from a write collaborator', async () => {
    const gitea = repoGitea({ getCollaboratorPermission: async () => 'write' });
    await expect(getAccessLevel(gitea as any, skill(), 'acme_bob')).resolves.toBe('write');
  });

  it('derives manage from an admin collaborator', async () => {
    const gitea = repoGitea({ getCollaboratorPermission: async () => 'admin' });
    await expect(getAccessLevel(gitea as any, skill(), 'acme_bob')).resolves.toBe('manage');
  });

  it('does not downgrade a team write grant when the collaborator grant is read', async () => {
    const gitea = repoGitea({
      listRepoTeams: async () => [{ id: 8, name: 'frontend-write', permission: 'write' }],
      isTeamMember: async () => true,
      getCollaboratorPermission: async () => 'read'
    });
    await expect(getAccessLevel(gitea as any, skill(), 'acme_bob')).resolves.toBe('write');
  });

  it('keeps the public read baseline when the team query fails', async () => {
    const gitea = repoGitea({ listRepoTeams: async () => { throw new Error('backend down'); } });
    await expect(getAccessLevel(gitea as any, skill({ visibility: 'public' }), 'acme_bob')).resolves.toBe('read');
  });

  it('propagates the backend failure for a private skill', async () => {
    const gitea = repoGitea({ listRepoTeams: async () => { throw new Error('backend down'); } });
    await expect(getAccessLevel(gitea as any, skill(), 'acme_bob')).rejects.toThrow('backend down');
  });

  it('parses repo owner and name from the skill repo path', () => {
    expect(skillRepo(skill({ gitRepoPath: 'acme/reviewer' }))).toEqual({ owner: 'acme', name: 'reviewer' });
  });

  it('keeps manage verdicts because canManageSkill is only true for manage', async () => {
    const gitea = repoGitea({ getCollaboratorPermission: async () => 'write' });
    await expect(canManageSkill(gitea as any, skill(), 'acme_bob')).resolves.toBe(false);
    const admin = repoGitea({ getCollaboratorPermission: async () => 'admin' });
    await expect(canManageSkill(admin as any, skill(), 'acme_bob')).resolves.toBe(true);
  });

  it('reports hasReadAccess true from read and up, false for none', async () => {
    const read = repoGitea({ getCollaboratorPermission: async () => 'read' });
    await expect(hasReadAccess(read as any, skill(), 'acme_bob')).resolves.toBe(true);
    const none = repoGitea();
    await expect(hasReadAccess(none as any, skill(), 'acme_bob')).resolves.toBe(false);
  });
});
