import { describe, expect, it, vi } from 'vitest';
import { GiteaService } from '../src/services/gitea.js';

describe('GiteaService', () => {
  it('validates user token via Gitea API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, username: 'zhangsan', email: 'zhangsan@example.com' })
    });

    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);
    const user = await gitea.validateToken('user-token-123');

    expect(user).toEqual({ id: 1, username: 'zhangsan', email: 'zhangsan@example.com' });
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/user', {
      headers: { Authorization: 'token user-token-123' }
    });
  });

  it('creates an organization repository after a user repository request returns 404', async () => {
    const repo = {
      id: 1,
      name: 'skill-library',
      full_name: 'acme/skill-library',
      clone_url: 'http://gitea:3000/acme/skill-library.git',
      html_url: 'http://gitea:3000/acme/skill-library'
    };
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, json: async () => repo });

    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.createRepo('acme', 'skill-library', true)).resolves.toEqual(repo);
    expect(mockFetch).toHaveBeenNthCalledWith(1, 'http://gitea:3000/api/v1/admin/users/acme/repos', {
      method: 'POST',
      headers: {
        Authorization: 'token admin-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: 'skill-library', private: true, auto_init: false })
    });
    expect(mockFetch).toHaveBeenNthCalledWith(2, 'http://gitea:3000/api/v1/orgs/acme/repos', {
      method: 'POST',
      headers: {
        Authorization: 'token admin-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: 'skill-library', private: true, auto_init: false })
    });
  });

  it('gets a repository via the Gitea API', async () => {
    const repo = {
      id: 1,
      name: 'skill-library',
      full_name: 'acme/skill-library',
      clone_url: 'http://gitea:3000/acme/skill-library.git',
      html_url: 'http://gitea:3000/acme/skill-library'
    };
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => repo });

    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.getRepo('acme', 'skill-library')).resolves.toEqual(repo);
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/repos/acme/skill-library', {
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('returns null when a repository is not found', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.getRepo('acme', 'missing-skill')).resolves.toBeNull();
  });

  it('throws when repository lookup fails for reasons other than not found', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'bad credentials'
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.getRepo('acme', 'private-skill')).rejects.toThrow(
      'Failed to get Gitea repository: bad credentials'
    );
  });
});
