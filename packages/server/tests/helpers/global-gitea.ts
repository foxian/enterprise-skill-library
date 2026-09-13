import { vi } from 'vitest';

// 有状态假 Gitea（全局账号 + 组织语义，ADR-0032）：账号无 <org>_ 前缀，
// 组织 = 带 Owners 团队的 Gitea org，登录换发 token，token → 全局身份。
// 只实现测试消费的子集；调用方可像覆盖 vi.fn 一样覆盖单个方法。

export interface FakeGiteaUser {
  username: string;
  password: string;
}

export interface FakeGiteaTeam {
  id: number;
  name: string;
  permission: 'read' | 'write' | 'admin' | 'owner';
  members: Set<string>;
}

export interface FakeGiteaOrg {
  name: string;
  teams: FakeGiteaTeam[];
}

export interface GlobalGiteaSeed {
  users?: FakeGiteaUser[];
  orgs?: FakeGiteaOrg[];
}

export function createGlobalGitea(seed: GlobalGiteaSeed = {}) {
  const users = new Map<string, string>();
  const tokens = new Map<string, string>(); // token → username
  let tokenCounter = 0;
  let teamIdCounter = 100;
  const orgs = new Map<string, FakeGiteaOrg>();

  for (const user of seed.users ?? []) {
    users.set(user.username, user.password);
  }
  for (const org of seed.orgs ?? []) {
    orgs.set(
      org.name,
      org.teams.length > 0
        ? org
        : // 无显式团队时按 Gitea 原生形状补 Owners 团队
          {
            name: org.name,
            teams: [{ id: teamIdCounter++, name: 'Owners', permission: 'owner' as const, members: new Set<string>() }]
          }
    );
  }

  const ownersTeam = (org: FakeGiteaOrg): FakeGiteaTeam | undefined =>
    org.teams.find((team) => team.permission === 'owner');

  const ensureTeam = (orgName: string, name: string, permission: FakeGiteaTeam['permission']): FakeGiteaTeam => {
    const org = orgs.get(orgName);
    if (!org) throw new Error(`No such organization: ${orgName}`);
    const existing = org.teams.find((team) => team.name === name);
    if (existing) return existing;
    const team: FakeGiteaTeam = { id: teamIdCounter++, name, permission, members: new Set() };
    org.teams.push(team);
    return team;
  };

  return {
    adminUsername: 'eslroot' as const,

    validateToken: vi.fn(async (token: string) => {
      const username = tokens.get(token);
      return username ? { id: 1, username, email: `${username}@local.esl` } : null;
    }),

    loginUser: vi.fn(async (username: string, password: string) => {
      if (users.get(username) !== password) return null;
      const token = `gitea-token-${++tokenCounter}-${username}`;
      tokens.set(token, username);
      return token;
    }),

    listUserOrgs: vi.fn(async (username: string) =>
      Array.from(orgs.values())
        .filter((org) => org.teams.some((team) => team.members.has(username)))
        .map((org) => ({ id: org.name.length, name: org.name }))
    ),

    listTeams: vi.fn(async (org: string) =>
      (orgs.get(org)?.teams ?? []).map((team) => ({ id: team.id, name: team.name, permission: team.permission }))
    ),

    listTeamMembers: vi.fn(async (teamId: number) => {
      for (const org of orgs.values()) {
        const team = org.teams.find((candidate) => candidate.id === teamId);
        if (team) {
          return Array.from(team.members).map((username) => ({ id: 1, username, email: `${username}@local.esl` }));
        }
      }
      return [];
    }),

    listOrgOwners: vi.fn(async (orgName: string) => {
      const org = orgs.get(orgName);
      if (!org) return [];
      const owners = ownersTeam(org);
      return owners
        ? Array.from(owners.members).map((username) => ({ id: 1, username, email: `${username}@local.esl` }))
        : [];
    }),

    isTeamMember: vi.fn(async (teamId: number, username: string) => {
      for (const org of orgs.values()) {
        const team = org.teams.find((candidate) => candidate.id === teamId);
        if (team) return team.members.has(username);
      }
      return false;
    }),

    createOrg: vi.fn(async (name: string) => {
      if (!orgs.has(name)) {
        orgs.set(name, {
          name,
          teams: [{ id: teamIdCounter++, name: 'Owners', permission: 'owner' as const, members: new Set<string>() }]
        });
      }
    }),

    createTeam: vi.fn(async (org: string, name: string, permission: FakeGiteaTeam['permission']) =>
      ensureTeam(org, name, permission)
    ),

    addTeamMember: vi.fn(async (teamId: number, username: string) => {
      for (const org of orgs.values()) {
        const team = org.teams.find((candidate) => candidate.id === teamId);
        if (team) {
          team.members.add(username);
          return;
        }
      }
      throw new Error(`No such team: ${teamId}`);
    }),

    createUser: vi.fn(async (username: string, password: string) => {
      users.set(username, password);
    }),

    // 测试断言辅助：直接操纵组织内状态
    __state: {
      orgs,
      users,
      tokens,
      ownersTeam,
      ensureTeam,
      setOrgOwner(orgName: string, username: string): void {
        const org = orgs.get(orgName);
        if (!org) throw new Error(`No such organization: ${orgName}`);
        ownersTeam(org)!.members.add(username);
      },
      addOrgMember(orgName: string, username: string, permission: Exclude<FakeGiteaTeam['permission'], 'owner'> = 'read'): void {
        const team = ensureTeam(orgName, `members-${permission}`, permission);
        team.members.add(username);
      }
    }
  };
}

export type GlobalGiteaFake = ReturnType<typeof createGlobalGitea>;
