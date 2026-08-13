import crypto from 'node:crypto';

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

  async createUser(username: string): Promise<void> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/admin/users`, {
      method: 'POST',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username,
        email: `${username}@local.esl`,
        password: crypto.randomUUID(),
        must_change_password: false
      })
    });

    if (!res.ok && res.status !== 409) {
      const err = await res.text();
      throw new Error(`Failed to create Gitea user: ${err}`);
    }
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
      body: JSON.stringify({ password })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to change Gitea user password: ${err}`);
    }
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

  async organizationExists(owner: string): Promise<boolean> {
    const res = await this.customFetch(`${this.baseUrl}/api/v1/orgs/${owner}`, {
      headers: { Authorization: `token ${this.adminToken}` }
    });

    if (res.ok) return true;
    if (res.status === 404) return false;

    const err = await res.text();
    throw new Error(`Failed to get Gitea organization: ${err}`);
  }

  async ensureOrganization(owner: string): Promise<void> {
    if (await this.organizationExists(owner)) return;

    const res = await this.customFetch(`${this.baseUrl}/api/v1/orgs`, {
      method: 'POST',
      headers: {
        Authorization: `token ${this.adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: owner })
    });

    if (!res.ok && res.status !== 409) {
      const err = await res.text();
      throw new Error(`Failed to create Gitea organization: ${err}`);
    }
  }
}
