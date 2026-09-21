import { vi } from 'vitest';

// 有状态假 Gitea（全局账号 + 组织语义，ADR-0032）：账号无 <org>_ 前缀，
// 组织 = 带 Owners 团队的 Gitea org，登录换发 token，token → 全局身份。
// 只实现测试消费的子集；调用方可像覆盖 vi.fn 一样覆盖单个方法。

export interface FakeGiteaUser {
  username: string;
  password: string;
  email?: string;
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
  const emails = new Map<string, string>();
  const mustChangePasswords = new Map<string, boolean>();
  const tokens = new Map<string, string>(); // token → username
  const disabled = new Set<string>();
  let tokenCounter = 0;
  let teamIdCounter = 100;
  const orgs = new Map<string, FakeGiteaOrg>();
  // 仓库挂载的团队与协作者（权限事实源的状态镜像）
  const repoTeams = new Map<string, Set<number>>(); // "owner/repo" → teamIds
  const collaborators = new Map<string, Map<string, 'read' | 'write' | 'admin'>>();
  const repos = new Set<string>(); // 已创建的仓库（"owner/repo"）

  for (const user of seed.users ?? []) {
    users.set(user.username, user.password);
    emails.set(user.username, user.email ?? `${user.username}@local.esl`);
    mustChangePasswords.set(user.username, false);
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

    validateAdminUserToken: vi.fn(async (token: string) => {
      const username = tokens.get(token);
      return username === 'eslroot' ? { id: 1, username, email: `${username}@local.esl` } : null;
    }),

    loginUser: vi.fn(async (username: string, password: string) => {
      if (users.get(username) !== password || disabled.has(username)) return null;
      const token = `gitea-token-${++tokenCounter}-${username}`;
      tokens.set(token, username);
      return token;
    }),

    validateUserPassword: vi.fn(async (username: string, password: string) =>
      !disabled.has(username) && users.get(username) === password
    ),

    listUsers: vi.fn(async () => {
      return Array.from(users.keys())
        .map((username) => ({
          id: 1,
          username,
          email: emails.get(username) ?? `${username}@local.esl`,
          active: true,
          prohibit_login: disabled.has(username)
        }));
    }),

    listUserOrgs: vi.fn(async (username: string) =>
      Array.from(orgs.values())
        .filter((org) => org.teams.some((team) => team.members.has(username)))
        .map((org) => ({ id: org.name.length, name: org.name }))
    ),

    listOrgRepos: vi.fn(async (_orgName: string) => [] as Array<{ id: number; name: string; full_name: string }>),

    deleteOrg: vi.fn(async (orgName: string) => {
      orgs.delete(orgName);
    }),

    listOrgMembers: vi.fn(async (orgName: string) => {
      const org = orgs.get(orgName);
      if (!org) return [];
      const usernames = new Set<string>();
      for (const team of org.teams) {
        for (const member of team.members) usernames.add(member);
      }
      return Array.from(usernames).map((username) => ({ id: 1, username, email: `${username}@local.esl` }));
    }),

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

    // GiteaService.createRepo 的语义：先按 admin/users/{owner}/repos 建（个人
    // 仓库与组织仓库同型），组织不存在时回退 /orgs/{owner}/repos。
    createRepo: vi.fn(async (owner: string, name: string, isPrivate = false) => {
      repos.add(`${owner}/${name}`);
      return {
        id: 1,
        name,
        full_name: `${owner}/${name}`,
        clone_url: `http://gitea.local/${owner}/${name}.git`,
        html_url: `http://gitea.local/${owner}/${name}`,
        private: isPrivate
      };
    }),

    createOrganizationRepo: vi.fn(async (owner: string, name: string, isPrivate = false) => {
      repos.add(`${owner}/${name}`);
      return {
        id: 1,
        name,
        full_name: `${owner}/${name}`,
        clone_url: `http://gitea.local/${owner}/${name}.git`,
        html_url: `http://gitea.local/${owner}/${name}`,
        private: isPrivate
      };
    }),

    deleteRepo: vi.fn(async (owner: string, name: string) => {
      repos.delete(`${owner}/${name}`);
    }),

    addCollaborator: vi.fn(async (owner: string, repo: string, username: string, permission: 'read' | 'write' | 'admin' = 'write') => {
      const key = `${owner}/${repo}`;
      let perRepo = collaborators.get(key);
      if (!perRepo) {
        perRepo = new Map();
        collaborators.set(key, perRepo);
      }
      perRepo.set(username, permission);
    }),

    removeCollaborator: vi.fn(async (owner: string, repo: string, username: string) => {
      collaborators.get(`${owner}/${repo}`)?.delete(username);
    }),

    listCollaborators: vi.fn(async (owner: string, repo: string) =>
      Array.from(collaborators.get(`${owner}/${repo}`)?.entries() ?? []).map(([username, permission]) => ({
        username,
        permission
      }))
    ),

    getCollaboratorPermission: vi.fn(async (owner: string, repo: string, username: string) =>
      collaborators.get(`${owner}/${repo}`)?.get(username) ?? 'none'
    ),

    isCollaborator: vi.fn(async (owner: string, repo: string, username: string) =>
      collaborators.get(`${owner}/${repo}`)?.has(username) ?? false
    ),

    addTeamRepo: vi.fn(async (teamId: number, owner: string, repo: string) => {
      const key = `${owner}/${repo}`;
      let mounted = repoTeams.get(key);
      if (!mounted) {
        mounted = new Set();
        repoTeams.set(key, mounted);
      }
      mounted.add(teamId);
    }),

    removeTeamRepo: vi.fn(async (teamId: number, owner: string, repo: string) => {
      repoTeams.get(`${owner}/${repo}`)?.delete(teamId);
    }),

    listRepoTeams: vi.fn(async (owner: string, repo: string) => {
      const org = orgs.get(owner);
      // 个人仓库（owner 不是组织）：Gitea 返回 4xx 而非空列表
      if (!org) {
        throw new Error(
          `Failed to list Gitea repository teams: {"message":"repo is not owned by an organization"}`
        );
      }
      const mounted = repoTeams.get(`${owner}/${repo}`);
      if (!mounted) return [];
      return org.teams
        .filter((team) => mounted.has(team.id))
        .map((team) => ({ id: team.id, name: team.name, permission: team.permission }));
    }),

    readSourceTree: vi.fn(async (_owner: string, _repo: string, _ref: string) => ({}) as Record<string, string>),

    getReleaseTag: vi.fn(async (_owner: string, _repo: string, _tag: string) => null),

    createReleaseTag: vi.fn(async (_owner: string, _repo: string, _tag: string, _target: string, _message: string) => {}),

    createTeam: vi.fn(async (org: string, name: string, permission: FakeGiteaTeam['permission']) =>
      ensureTeam(org, name, permission)
    ),

    updateTeam: vi.fn(async (teamId: number, changes: { name?: string; permission?: FakeGiteaTeam['permission'] }) => {
      for (const org of orgs.values()) {
        const team = org.teams.find((candidate) => candidate.id === teamId);
        if (team) {
          if (changes.name !== undefined) team.name = changes.name;
          if (changes.permission !== undefined) team.permission = changes.permission;
          return { id: team.id, name: team.name, permission: team.permission };
        }
      }
      throw new Error(`No such team: ${teamId}`);
    }),

    deleteTeam: vi.fn(async (teamId: number) => {
      for (const org of orgs.values()) {
        const index = org.teams.findIndex((candidate) => candidate.id === teamId);
        if (index >= 0) {
          org.teams.splice(index, 1);
          return;
        }
      }
    }),

    listTeamRepos: vi.fn(async (teamId: number) =>
      Array.from(repoTeams.entries())
        .filter(([, teamIds]) => teamIds.has(teamId))
        .map(([fullName]) => ({
          id: 1,
          name: fullName.slice(fullName.indexOf('/') + 1),
          full_name: fullName
        }))
    ),

    removeOrgMember: vi.fn(async (orgName: string, username: string) => {
      const org = orgs.get(orgName);
      if (!org) return;
      for (const team of org.teams) {
        team.members.delete(username);
      }
    }),

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

    removeTeamMember: vi.fn(async (teamId: number, username: string) => {
      for (const org of orgs.values()) {
        const team = org.teams.find((candidate) => candidate.id === teamId);
        if (team) {
          team.members.delete(username);
          return;
        }
      }
    }),

    createUser: vi.fn(async (
      username: string,
      password: string,
      options: { email?: string; mustChangePassword?: boolean } = {}
    ) => {
      users.set(username, password);
      emails.set(username, options.email ?? `${username}@local.esl`);
      mustChangePasswords.set(username, options.mustChangePassword ?? false);
    }),

    getUser: vi.fn(async (username: string) => {
      if (users.has(username)) {
        return { id: 1, username, email: emails.get(username) ?? `${username}@local.esl` };
      }
      // Gitea 里组织与用户共享同一命名空间（org 即 users 表的 organization 类型）
      if (orgs.has(username)) {
        return { id: 2, username, email: `${username}@local.esl` };
      }
      return null;
    }),

    changeUserEmail: vi.fn(async (username: string, email: string) => {
      if (!users.has(username)) throw new Error(`No such user: ${username}`);
      emails.set(username, email);
    }),

    organizationExists: vi.fn(async (orgName: string) => orgs.has(orgName)),

    disableUser: vi.fn(async (username: string) => {
      disabled.add(username);
    }),

    enableUser: vi.fn(async (username: string) => {
      disabled.delete(username);
    }),

    revokeUserTokens: vi.fn(async (username: string) => {
      tokens.forEach((tokenUsername, token) => {
        if (tokenUsername === username) tokens.delete(token);
      });
    }),

    deleteUser: vi.fn(async (username: string) => {
      users.delete(username);
      disabled.delete(username);
      tokens.forEach((tokenUsername, token) => {
        if (tokenUsername === username) tokens.delete(token);
      });
    }),

    // 测试断言辅助：直接操纵组织内状态
    __state: {
      orgs,
      users,
      emails,
      mustChangePasswords,
      tokens,
      repos,
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
