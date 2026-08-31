export interface GiteaUser {
  id: number;
  username: string;
  email: string;
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
}

export interface GiteaTeam {
  id: number;
  name: string;
  permission: 'read' | 'write' | 'admin';
}

export class GiteaService {
  constructor(
    private baseUrl: string,
    private adminToken: string,
    private customFetch: typeof fetch = fetch,
    private adminUsername?: string,
    private adminPassword?: string
  ) {}

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
        email: `${username}@local.esl`,
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
      body: JSON.stringify({ prohibit_login: true })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to disable Gitea user: ${err}`);
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
        email: `${username}@local.esl`,
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

    const body = (await res.json()) as Array<{ id: number; name: string }>;
    return body.map((org) => ({ id: org.id, name: org.name }));
  }

  async createTeam(org: string, name: string, permission: 'read' | 'write'): Promise<GiteaTeam> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/orgs/${org}/teams`, {
      method: 'POST',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, permission })
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
    const res = await this.customFetch(`${this.baseUrl}/api/v1/orgs/${org}/members`, {
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to list Gitea organization members: ${err}`);
    }

    return (await res.json()) as GiteaUser[];
  }

  async deleteUser(username: string): Promise<void> {
    const res = await this.customFetch(
      `${this.baseUrl}/api/v1/admin/users/${encodeURIComponent(username)}?purge=true`,
      {
        method: 'DELETE',
        headers: { Authorization: `token ${this.adminToken}` }
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to delete Gitea user: ${err}`);
    }
  }

  async listCollaborators(owner: string, repository: string): Promise<GiteaUser[]> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/repos/${owner}/${repository}/collaborators`, {
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to list Gitea repository collaborators: ${err}`);
    }

    return (await res.json()) as GiteaUser[];
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
