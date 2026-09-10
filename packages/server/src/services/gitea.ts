import { giteaUserEmail } from '@esl/core';

export interface GiteaUser {
  id: number;
  username: string;
  email: string;
}

// admin users API 返回的完整用户记录。注意:禁用(prohibit_login=true)不会改变
// active 字段(它恒为账号激活态),识别"被禁用"须看 prohibit_login。
export interface GiteaAdminUser extends GiteaUser {
  active: boolean;
  prohibit_login: boolean;
}

export interface GiteaRepo {
  id: number;
  name: string;
  full_name: string;
  clone_url: string;
  html_url: string;
}

export interface GiteaContentEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  content?: string;
  encoding?: string;
}

export interface GiteaTag {
  name: string;
  target: string;
}

export interface GiteaOrg {
  id: number;
  name: string;
  created?: string;
}

export interface GiteaTeam {
  id: number;
  name: string;
  permission: 'read' | 'write' | 'admin' | 'owner';
}

// Gitea 仓库单元全集。创建/编辑团队时以此构建 units_map:单元级只有
// read/write 两档,admin(Manage)档的单元仍按 write 授予,仓库访问级别由
// team.permission 表达(ADR-0025/0029)。
const TEAM_REPO_UNITS = [
  'repo.actions',
  'repo.issues',
  'repo.ext_issues',
  'repo.wiki',
  'repo.ext_wiki',
  'repo.pulls',
  'repo.releases',
  'repo.projects',
  'repo.packages',
  'repo.code'
];

export class GiteaService {
  constructor(
    private baseUrl: string,
    private adminToken: string,
    private customFetch: typeof fetch = fetch,
    readonly adminUsername?: string,
    private adminPassword?: string
  ) {}

  async listUsers(search?: string): Promise<GiteaAdminUser[]> {
    const url = new URL(`${this.baseUrl}/api/v1/admin/users`);
    url.searchParams.set('limit', '50');
    if (search) {
      url.searchParams.set('search', search);
    }
    const res = await this.customFetch(url.toString(), {
      headers: { Authorization: `token ${this.adminToken}` }
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to list Gitea users: ${err}`);
    }
    return (await res.json()) as GiteaAdminUser[];
  }

  async validateToken(token: string): Promise<GiteaUser | null> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/user`, {
      headers: { Authorization: `token ${token}` }
    });

    if (!res.ok) return null;
    return (await res.json()) as GiteaUser;
  }

  async validateAdminToken(token: string): Promise<boolean> {
    return (await this.validateToken(token)) !== null;
  }

  async validateAdminUserToken(token: string): Promise<GiteaUser | null> {
    if (!this.adminUsername) {
      return null;
    }
    const user = await this.validateToken(token);
    return user && user.username === this.adminUsername ? user : null;
  }

  async isReady(): Promise<boolean> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/version`);
    return res.ok;
  }

  async getBootstrapStatus(repoOwner: string): Promise<{
    ready: boolean;
    gitea: 'ready' | 'missing';
    adminToken: 'ready' | 'missing' | 'invalid';
    repoOwner: 'ready' | 'missing';
  }> {
    const gitea = (await this.isReady()) ? 'ready' : 'missing';
    const adminToken = (await this.validateAdminToken(this.adminToken)) ? 'ready' : 'invalid';
    const repoOwnerReady = await this.organizationExists(repoOwner);
    return {
      ready: gitea === 'ready' && adminToken === 'ready' && repoOwnerReady,
      gitea,
      adminToken,
      repoOwner: repoOwnerReady ? 'ready' : 'missing'
    };
  }

  async createUser(username: string, password: string): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/admin/users`, {
      method: 'POST',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username,
        email: giteaUserEmail(username),
        password,
        must_change_password: false
      })
    });

    if (!res.ok && res.status !== 409) {
      const err = await res.text();
      throw new Error(`Failed to create Gitea user: ${err}`);
    }
  }

  async validateUserPassword(username: string, password: string): Promise<boolean> {
    const basicAuth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    const res = await this.customFetch(`${this.baseUrl}/api/v1/user`, {
      headers: { Authorization: basicAuth }
    });
    return res.ok;
  }

  async issueUserToken(username: string): Promise<string> {
    if (!this.adminUsername || !this.adminPassword) {
      throw new Error('Gitea admin username/password required to issue user tokens');
    }
    const basicAuth = `Basic ${Buffer.from(`${this.adminUsername}:${this.adminPassword}`).toString('base64')}`;
    const res = await this.customFetch(`${this.baseUrl}/api/v1/users/${username}/tokens`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: `esl-cli-${Date.now()}`, scopes: ['all'] })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to issue Gitea user token: ${err}`);
    }

    const body = (await res.json()) as { sha1: string };
    return body.sha1;
  }

  async loginUser(username: string, password: string): Promise<string | null> {
    const basicAuth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    const res = await this.customFetch(`${this.baseUrl}/api/v1/users/${username}/tokens`, {
      method: 'POST',
      headers: {
        Authorization: basicAuth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: `esl-cli-${Date.now()}`, scopes: ['all'] })
    });

    if (res.status === 401 || res.status === 403) {
      return null;
    }
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to authenticate with Gitea: ${err}`);
    }

    const body = (await res.json()) as { sha1: string };
    return body.sha1;
  }

  async disableUser(username: string): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/admin/users/${username}`, {
      method: 'PATCH',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ login_name: username, prohibit_login: true })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to disable Gitea user: ${err}`);
    }
  }

  async enableUser(username: string): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/admin/users/${username}`, {
      method: 'PATCH',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ login_name: username, prohibit_login: false })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to enable Gitea user: ${err}`);
    }
  }

  async changeUserPassword(username: string, password: string): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/admin/users/${username}`, {
      method: 'PATCH',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ login_name: username, password })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to change Gitea user password: ${err}`);
    }
  }

  async changeAdminPassword(password: string): Promise<void> {
    if (!this.adminUsername) {
      throw new Error('Gitea admin username required to change the administrator password');
    }
    await this.changeUserPassword(this.adminUsername, password);
  }

  async ensureAdminUser(username: string, password: string): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/admin/users`, {
      method: 'POST',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username,
        email: giteaUserEmail(username),
        password,
        must_change_password: false
      })
    });

    if (!res.ok && res.status !== 409) {
      const err = await res.text();
      throw new Error(`Failed to ensure Gitea admin user: ${err}`);
    }
  }

  async createAdminToken(username: string, tokenName: string): Promise<string> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/admin/users/${username}/tokens`, {
      method: 'POST',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: tokenName })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to create Gitea admin token: ${err}`);
    }

    const body = (await res.json()) as { sha1: string };
    return body.sha1;
  }

  async createRepo(owner: string, name: string, isPrivate = false): Promise<GiteaRepo> {
    let url = `${this.baseUrl}/api/v1/admin/users/${owner}/repos`;
    let res = await this.customFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, private: isPrivate, auto_init: false })
    });

    if (!res.ok && res.status === 404) {
      url = `${this.baseUrl}/api/v1/orgs/${owner}/repos`;
      res = await this.customFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `token ${this.adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, private: isPrivate, auto_init: false })
      });
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to create Gitea repository: ${err}`);
    }

    return (await res.json()) as GiteaRepo;
  }

  async createOrganizationRepo(owner: string, name: string, isPrivate = false): Promise<GiteaRepo> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/orgs/${owner}/repos`, {
      method: 'POST',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, private: isPrivate, auto_init: false })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to create Gitea organization repository: ${err}`);
    }

    return (await res.json()) as GiteaRepo;
  }

  async getRepo(owner: string, name: string): Promise<GiteaRepo | null> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/repos/${owner}/${name}`, {
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (res.ok) return (await res.json()) as GiteaRepo;
    if (res.status === 404) return null;

    const err = await res.text();
    throw new Error(`Failed to get Gitea repository: ${err}`);
  }

  async renameRepo(owner: string, name: string, nextName: string): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/repos/${owner}/${name}`, {
      method: 'PATCH',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: nextName })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to rename Gitea repository: ${err}`);
    }
  }

  async deleteRepo(owner: string, name: string): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/repos/${owner}/${name}`, {
      method: 'DELETE',
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (!res.ok && res.status !== 404) {
      const err = await res.text();
      throw new Error(`Failed to delete Gitea repository: ${err}`);
    }
  }

  async createOrg(name: string): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/orgs`, {
      method: 'POST',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: name })
    });

    if (!res.ok && res.status !== 409) {
      const err = await res.text();
      throw new Error(`Failed to create Gitea organization: ${err}`);
    }
  }

  async listOrgRepos(org: string): Promise<GiteaRepo[]> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/orgs/${org}/repos`, {
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to list Gitea organization repositories: ${err}`);
    }

    return (await res.json()) as GiteaRepo[];
  }

  async deleteOrg(name: string): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/orgs/${name}`, {
      method: 'DELETE',
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (!res.ok && res.status !== 404) {
      const err = await res.text();
      throw new Error(`Failed to delete Gitea organization: ${err}`);
    }
  }

  async listOrgs(): Promise<GiteaOrg[]> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/admin/orgs`, {
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to list Gitea organizations: ${err}`);
    }

    const body = (await res.json()) as Array<{ id: number; name: string; created?: string }>;
    return body.map((org) => ({ id: org.id, name: org.name, created: org.created }));
  }

  async createTeam(
    org: string,
    name: string,
    permission: 'read' | 'write' | 'admin',
    options: { includesAllRepositories?: boolean; canCreateOrgRepo?: boolean } = {}
  ): Promise<GiteaTeam> {
    // Gitea 1.22 创建团队时必须提供 units_map，否则报 "units permission should not be empty"。
    // 将全部仓库单元都授予该权限级别，使新团队默认具备对组织仓库的读写访问。
    // admin 团队(ADR-0025 Manage 档)的仓库单元仍按 write 授予——单元级只有
    // read/write 两档,仓库访问级别由 team.permission=admin 表达。
    // includesAllRepositories / canCreateOrgRepo 用于系统管理团队(ADR-0026):
    // 全部仓库的结构性 admin 授权与 Git Backend 建库权;普通团队显式为 false,
    // 不留给 Gitea 默认值。
    const unitPermission: 'read' | 'write' = permission === 'admin' ? 'write' : permission;
    const unitsMap: Record<string, 'read' | 'write'> = Object.fromEntries(
      TEAM_REPO_UNITS.map((unit) => [unit, unitPermission])
    );
    const res = await this.customFetch(`${this.baseUrl}/api/v1/orgs/${org}/teams`, {
      method: 'POST',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        permission,
        units_map: unitsMap,
        includes_all_repositories: options.includesAllRepositories ?? false,
        can_create_org_repo: options.canCreateOrgRepo ?? false
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to create Gitea team: ${err}`);
    }

    const body = (await res.json()) as { id: number; name: string; permission: GiteaTeam['permission'] };
    return { id: body.id, name: body.name, permission: body.permission };
  }

  async deleteTeam(teamId: number): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/teams/${teamId}`, {
      method: 'DELETE',
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (!res.ok && res.status !== 404) {
      const err = await res.text();
      throw new Error(`Failed to delete Gitea team: ${err}`);
    }
  }

  // 团队编辑(ADR-0029):可改标识名与权限档。Gitea 的 EditTeam 是部分更新——
  // 只发 name 不动权限;改权限时必须连带 units_map,否则单元级授权停留在旧档,
  // 实际仓库访问与顶级权限不一致。标识名按团队 ID 引用,改名不断授权(ADR-0026)。
  async updateTeam(
    teamId: number,
    changes: { name?: string; permission?: 'read' | 'write' | 'admin' }
  ): Promise<GiteaTeam> {
    const body: Record<string, unknown> = {};
    if (changes.name !== undefined) body.name = changes.name;
    if (changes.permission !== undefined) {
      body.permission = changes.permission;
      const unitPermission: 'read' | 'write' = changes.permission === 'admin' ? 'write' : changes.permission;
      body.units_map = Object.fromEntries(
        TEAM_REPO_UNITS.map((unit) => [unit, unitPermission])
      );
    }
    const res = await this.customFetch(`${this.baseUrl}/api/v1/teams/${teamId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to update Gitea team: ${err}`);
    }

    const response = (await res.json()) as { id: number; name: string; permission: GiteaTeam['permission'] };
    return { id: response.id, name: response.name, permission: response.permission };
  }

  async listTeams(org: string): Promise<GiteaTeam[]> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/orgs/${org}/teams`, {
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to list Gitea teams: ${err}`);
    }

    const body = (await res.json()) as Array<{ id: number; name: string; permission: GiteaTeam['permission'] }>;
    return body.map((team) => ({ id: team.id, name: team.name, permission: team.permission }));
  }

  async addTeamMember(teamId: number, username: string): Promise<void> {
    const res = await this.customFetch(
      `${this.baseUrl}/api/v1/teams/${teamId}/members/${encodeURIComponent(username)}`,
      {
        method: 'PUT',
        headers: { Authorization: `token ${this.adminToken}` }
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to add Gitea team member: ${err}`);
    }
  }

  async removeTeamMember(teamId: number, username: string): Promise<void> {
    const res = await this.customFetch(
      `${this.baseUrl}/api/v1/teams/${teamId}/members/${encodeURIComponent(username)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `token ${this.adminToken}` }
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to remove Gitea team member: ${err}`);
    }
  }

  async addTeamRepo(teamId: number, owner: string, repo: string): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/teams/${teamId}/repos/${owner}/${repo}`, {
      method: 'PUT',
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to add Gitea team repository: ${err}`);
    }
  }

  async removeTeamRepo(teamId: number, owner: string, repo: string): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/teams/${teamId}/repos/${owner}/${repo}`, {
      method: 'DELETE',
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to remove Gitea team repository: ${err}`);
    }
  }

  async addCollaborator(
    owner: string,
    repository: string,
    username: string,
    permission: 'read' | 'write' | 'admin' = 'write'
  ): Promise<void> {
    const res = await this.customFetch(
      `${this.baseUrl}/api/v1/repos/${owner}/${repository}/collaborators/${encodeURIComponent(username)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `token ${this.adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ permission })
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to configure Gitea repository collaborator: ${err}`);
    }
  }

  async removeCollaborator(owner: string, repository: string, username: string): Promise<void> {
    const res = await this.customFetch(
      `${this.baseUrl}/api/v1/repos/${owner}/${repository}/collaborators/${encodeURIComponent(username)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `token ${this.adminToken}` }
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to remove Gitea repository collaborator: ${err}`);
    }
  }

  async listOrgMembers(org: string): Promise<GiteaUser[]> {
    // Gitea 列表接口有分页且默认单页截断,成员数超过一页后新成员会从列表
    // 中"消失"(成员管理、org-init 校验、org-delete 级联均依赖全量列表),
    // 必须循环翻页直到取完。单页上限用 Gitea 允许的最大值 50。
    const members: GiteaUser[] = [];
    const pageSize = 50;
    for (let page = 1; page <= 200; page++) {
      const res = await this.customFetch(
        `${this.baseUrl}/api/v1/orgs/${org}/members?limit=${pageSize}&page=${page}`,
        {
          headers: { Authorization: `token ${this.adminToken}` }
        }
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to list Gitea organization members: ${err}`);
      }

      const batch = (await res.json()) as GiteaUser[];
      members.push(...batch);
      if (batch.length < pageSize) {
        return members;
      }
    }
    return members;
  }

  async listTeamMembers(teamId: number): Promise<GiteaUser[]> {
    // 同 listOrgMembers:默认团队(all-readers/all-writers)成员会随组织增长,
    // 单页截断会让权限判定漏人,循环翻页取全量。
    const members: GiteaUser[] = [];
    const pageSize = 50;
    for (let page = 1; page <= 200; page++) {
      const res = await this.customFetch(
        `${this.baseUrl}/api/v1/teams/${teamId}/members?limit=${pageSize}&page=${page}`,
        {
          headers: { Authorization: `token ${this.adminToken}` }
        }
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to list Gitea team members: ${err}`);
      }

      const batch = (await res.json()) as GiteaUser[];
      members.push(...batch);
      if (batch.length < pageSize) {
        return members;
      }
    }
    return members;
  }

  async removeOrgMember(org: string, username: string): Promise<void> {
    const res = await this.customFetch(
      `${this.baseUrl}/api/v1/orgs/${org}/members/${encodeURIComponent(username)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `token ${this.adminToken}` }
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to remove Gitea organization member: ${err}`);
    }
  }

  async deleteUser(username: string): Promise<void> {
    const res = await this.customFetch(
      `${this.baseUrl}/api/v1/admin/users/${encodeURIComponent(username)}?purge=true`,
      {
        method: 'DELETE',
        headers: { Authorization: `token ${this.adminToken}` }
      }
    );

    // 容忍 404:可恢复清理流程重试时,账号可能已被上一次尝试删除。
    if (!res.ok && res.status !== 404) {
      const err = await res.text();
      throw new Error(`Failed to delete Gitea user: ${err}`);
    }
  }

  async listCollaborators(owner: string, repository: string): Promise<GiteaUser[]> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/repos/${owner}/${repository}/collaborators`, {
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (!res.ok) {
      if (res.status === 404) {
        // 仓库或组织不存在(如 DB 中的孤儿技能记录):视为没有任何协作者
        return [];
      }
      const err = await res.text();
      throw new Error(`Failed to list Gitea repository collaborators: ${err}`);
    }

    return (await res.json()) as GiteaUser[];
  }

  async listRepoTeams(owner: string, repository: string): Promise<GiteaTeam[]> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/repos/${owner}/${repository}/teams`, {
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (!res.ok) {
      if (res.status === 404) {
        // 仓库或组织不存在(如 DB 中的孤儿技能记录):视为没有任何团队
        return [];
      }
      const err = await res.text();
      throw new Error(`Failed to list Gitea repository teams: ${err}`);
    }

    const body = (await res.json()) as Array<{ id: number; name: string; permission: GiteaTeam['permission'] }>;
    return body.map((team) => ({ id: team.id, name: team.name, permission: team.permission }));
  }

  async isTeamMember(teamId: number, username: string): Promise<boolean> {
    const res = await this.customFetch(
      `${this.baseUrl}/api/v1/teams/${teamId}/members/${encodeURIComponent(username)}`,
      { headers: { Authorization: `token ${this.adminToken}` } }
    );

    if (res.ok) return true;
    if (res.status === 404) return false;

    const err = await res.text();
    throw new Error(`Failed to check Gitea team membership: ${err}`);
  }

  async isCollaborator(owner: string, repository: string, username: string): Promise<boolean> {
    const res = await this.customFetch(
      `${this.baseUrl}/api/v1/repos/${owner}/${repository}/collaborators/${encodeURIComponent(username)}`,
      { headers: { Authorization: `token ${this.adminToken}` } }
    );

    if (res.ok) return true;
    if (res.status === 404) return false;

    const err = await res.text();
    throw new Error(`Failed to check Gitea collaborator status: ${err}`);
  }

  async getCollaboratorPermission(owner: string, repository: string, username: string): Promise<string> {
    const res = await this.customFetch(
      `${this.baseUrl}/api/v1/repos/${owner}/${repository}/collaborators/${encodeURIComponent(username)}/permission`,
      { headers: { Authorization: `token ${this.adminToken}` } }
    );

    if (!res.ok) {
      if (res.status === 404) {
        // 仓库或组织不存在(如 DB 中的孤儿技能记录):视为没有任何权限
        return 'none';
      }
      const err = await res.text();
      throw new Error(`Failed to get Gitea collaborator permission: ${err}`);
    }

    const body = (await res.json()) as { permission: string };
    return body.permission;
  }

  async setRepositoryArchived(owner: string, repository: string, archived: boolean): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/repos/${owner}/${repository}`, {
      method: 'PATCH',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ archived })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to update Gitea repository archive state: ${err}`);
    }
  }

  async createReleaseTag(
    owner: string,
    repository: string,
    tag: string,
    target: string,
    message: string
  ): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/repos/${owner}/${repository}/tags`, {
      method: 'POST',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ tag_name: tag, target, message })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to create Gitea release tag: ${err}`);
    }
  }

  async getReleaseTag(owner: string, repository: string, tag: string): Promise<GiteaTag | null> {
    const res = await this.customFetch(
      `${this.baseUrl}/api/v1/repos/${owner}/${repository}/git/refs/tags/${encodeURIComponent(tag)}`,
      { headers: { Authorization: `token ${this.adminToken}` } }
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to get Gitea release tag: ${err}`);
    }

    const body = (await res.json()) as {
      ref?: string;
      object?: { sha?: string; type?: string };
      name?: string;
    };
    if (body.object?.type === 'tag' && body.object.sha) {
      const tagObject = await this.customFetch(
        `${this.baseUrl}/api/v1/repos/${owner}/${repository}/git/tags/${encodeURIComponent(body.object.sha)}`,
        { headers: { Authorization: `token ${this.adminToken}` } }
      );
      if (!tagObject.ok) {
        const err = await tagObject.text();
        throw new Error(`Failed to get Gitea annotated release tag: ${err}`);
      }
      const tagBody = (await tagObject.json()) as { object?: { sha?: string } };
      return {
        name: body.name ?? tag,
        target: tagBody.object?.sha ?? ''
      };
    }
    return {
      name: body.name ?? tag,
      target: body.object?.sha ?? body.ref?.replace(/^refs\/tags\//, '') ?? ''
    };
  }

  async readSourceTree(owner: string, repository: string, ref: string): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const readFileContent = async (entry: GiteaContentEntry): Promise<string> => {
      if (entry.content) {
        return entry.encoding === 'base64'
          ? Buffer.from(entry.content.replace(/\s/g, ''), 'base64').toString('utf8')
          : entry.content;
      }
      // The contents directory listing omits file contents; fetch each file
      // individually to get its content.
      const res = await this.customFetch(
        `${this.baseUrl}/api/v1/repos/${owner}/${repository}/contents/${entry.path}?ref=${encodeURIComponent(ref)}`,
        { headers: { Authorization: `token ${this.adminToken}` } }
      );
      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Failed to read source file ${entry.path}: ${error}`);
      }
      const file = (await res.json()) as { content?: string; encoding?: string };
      return file.encoding === 'base64'
        ? Buffer.from((file.content ?? '').replace(/\s/g, ''), 'base64').toString('utf8')
        : (file.content ?? '');
    };
    const visit = async (directory: string): Promise<void> => {
      const suffix = directory ? `/${directory}` : '';
      const response = await this.customFetch(
        `${this.baseUrl}/api/v1/repos/${owner}/${repository}/contents${suffix}?ref=${encodeURIComponent(ref)}`,
        { headers: { Authorization: `token ${this.adminToken}` } }
      );
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to read source commit: ${error}`);
      }
      const entries = (await response.json()) as GiteaContentEntry[];
      for (const entry of entries) {
        if (entry.type === 'dir') {
          await visit(entry.path);
        } else {
          files[entry.path] = await readFileContent(entry);
        }
      }
    };
    await visit('');
    return files;
  }

  async updateSkillName(owner: string, repository: string, shortName: string): Promise<void> {
    const url = `${this.baseUrl}/api/v1/repos/${owner}/${repository}/contents/SKILL.md?ref=main`;
    const read = await this.customFetch(url, {
      headers: { Authorization: `token ${this.adminToken}` }
    });
    if (!read.ok) {
      const error = await read.text();
      throw new Error(`Failed to read SKILL.md for rename: ${error}`);
    }
    const file = (await read.json()) as { content: string; sha: string; encoding?: string };
    const source = file.encoding === 'base64'
      ? Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8')
      : file.content;
    const updated = source.replace(
      /^(---\r?\n)([\s\S]*?)(\r?\n---)/,
      (_match, open: string, frontmatter: string, close: string) =>
        `${open}${frontmatter.replace(/(^name:\s*)[^\r\n]+/m, `$1${shortName}`)}${close}`
    );
    const write = await this.customFetch(
      `${this.baseUrl}/api/v1/repos/${owner}/${repository}/contents/SKILL.md`,
      {
        method: 'PUT',
        headers: {
          Authorization: `token ${this.adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          branch: 'main',
          message: `Rename skill to ${shortName}`,
          sha: file.sha,
          content: Buffer.from(updated, 'utf8').toString('base64')
        })
      }
    );
    if (!write.ok) {
      const error = await write.text();
      throw new Error(`Failed to update SKILL.md for rename: ${error}`);
    }
  }

  async organizationExists(owner: string): Promise<boolean> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/orgs/${owner}`, {
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (res.ok) return true;
    if (res.status === 404) return false;

    const err = await res.text();
    throw new Error(`Failed to get Gitea organization: ${err}`);
  }
}
