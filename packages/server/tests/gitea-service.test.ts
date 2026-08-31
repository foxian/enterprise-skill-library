import { describe, expect, it, vi } from 'vitest';
import { GiteaService } from '../src/services/gitea.js';

describe('GiteaService', () => {
  it('grants a maintainer write access to a repository', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.addCollaborator('platform-ai', 'reviewer', 'alice', 'write');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://gitea:3000/api/v1/repos/platform-ai/reviewer/collaborators/alice',
      {
        method: 'PUT',
        headers: {
          Authorization: 'token admin-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ permission: 'write' })
      }
    );
  });

  it('does not hide a failed collaborator grant', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'user not found' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(
      gitea.addCollaborator('platform-ai', 'reviewer', 'ghost', 'write')
    ).rejects.toThrow('Failed to configure Gitea repository collaborator: user not found');
  });

  it('updates repository archived state', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.setRepositoryArchived('platform-ai', 'reviewer', true);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://gitea:3000/api/v1/repos/platform-ai/reviewer',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ archived: true })
      })
    );
  });

  it('resolves an annotated release tag to its commit target', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'v1.0.0',
          object: { sha: 'tag-object', type: 'tag' }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ object: { sha: 'abc123' } })
      });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.getReleaseTag('platform-ai', 'reviewer', 'v1.0.0')).resolves.toEqual({
      name: 'v1.0.0',
      target: 'abc123'
    });
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'http://gitea:3000/api/v1/repos/platform-ai/reviewer/git/tags/tag-object',
      { headers: { Authorization: 'token admin-token' } }
    );
  });

  it('does not hide a conflicting tag creation response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 409, text: async () => 'conflict' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(
      gitea.createReleaseTag('platform-ai', 'reviewer', 'v1.0.0', 'abc123', 'Release')
    ).rejects.toThrow('Failed to create Gitea release tag');
  });

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

  it('creates a repository directly in an organization', async () => {
    const repo = {
      id: 1,
      name: 'alice_code-review',
      full_name: 'esl-skills/alice_code-review',
      clone_url: 'http://gitea:3000/esl-skills/alice_code-review.git',
      html_url: 'http://gitea:3000/esl-skills/alice_code-review'
    };
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => repo });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.createOrganizationRepo('esl-skills', 'alice_code-review')).resolves.toEqual(repo);
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/orgs/esl-skills/repos', {
      method: 'POST',
      headers: {
        Authorization: 'token admin-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: 'alice_code-review', private: false, auto_init: false })
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

  it('deletes a repository via the Gitea API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.deleteRepo('platform-ai', 'reviewer');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/repos/platform-ai/reviewer', {
      method: 'DELETE',
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('treats a missing repository as already deleted', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.deleteRepo('platform-ai', 'missing-skill')).resolves.toBeUndefined();
  });

  it('reads file contents from individual file endpoints when the directory listing omits them', async () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64');
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: 'SKILL.md', path: 'SKILL.md', type: 'file' },
          { name: 'assets', path: 'assets', type: 'dir' }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: b64('---\nname: demo\n---\n'), encoding: 'base64' })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ name: 'logo.png', path: 'assets/logo.png', type: 'file' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: b64('PNGDATA'), encoding: 'base64' })
      });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    const files = await gitea.readSourceTree('esl-skills', 'demo', 'abc123');

    expect(files).toEqual({
      'SKILL.md': '---\nname: demo\n---\n',
      'assets/logo.png': 'PNGDATA'
    });
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'http://gitea:3000/api/v1/repos/esl-skills/demo/contents/SKILL.md?ref=abc123',
      { headers: { Authorization: 'token admin-token' } }
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      'http://gitea:3000/api/v1/repos/esl-skills/demo/contents/assets/logo.png?ref=abc123',
      { headers: { Authorization: 'token admin-token' } }
    );
  });

  it('reports whether the Gitea backend is ready', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.22.0' })
    });

    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.isReady()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/version');
  });

  it('validates the configured Gitea administrator token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, username: 'admin', email: 'admin@local.esl' })
    });

    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.validateAdminToken('admin-token')).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/user', {
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('creates a user via the Gitea admin API with the given initial password', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.createUser('alice', 'initial-password');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/admin/users', {
      method: 'POST',
      headers: {
        Authorization: 'token admin-token',
        'Content-Type': 'application/json'
      },
      body: expect.stringContaining('"username":"alice"')
    });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).password).toBe('initial-password');
  });

  it('validates a user password via Gitea basic auth', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, username: 'alice', email: 'alice@local.esl' })
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.validateUserPassword('alice', 'correct-password')).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/user', {
      headers: { Authorization: `Basic ${Buffer.from('alice:correct-password').toString('base64')}` }
    });
  });

  it('rejects an invalid user password via Gitea basic auth', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.validateUserPassword('alice', 'wrong-password')).resolves.toBe(false);
  });

  it('issues a user token via the Gitea user tokens API with admin basic auth', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sha1: 'gitea-user-token' })
    });
    const gitea = new GiteaService(
      'http://gitea:3000',
      'admin-token',
      mockFetch as any,
      'eslroot',
      '123456123456'
    );

    await expect(gitea.issueUserToken('alice')).resolves.toBe('gitea-user-token');
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/users/alice/tokens', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from('eslroot:123456123456').toString('base64')}`,
        'Content-Type': 'application/json'
      },
      body: expect.any(String)
    });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).name).toMatch(/^esl-cli-/);
  });

  it('logs in a user by exchanging their password for a Gitea token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sha1: 'skill-user-token' })
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.loginUser('alice', 'correct-password')).resolves.toBe('skill-user-token');
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/users/alice/tokens', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from('alice:correct-password').toString('base64')}`,
        'Content-Type': 'application/json'
      },
      body: expect.any(String)
    });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).name).toMatch(/^esl-cli-/);
  });

  it('returns null when user password login fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'bad credentials'
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.loginUser('alice', 'wrong-password')).resolves.toBeNull();
  });

  it('throws when issuing a user token without admin credentials', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sha1: 'x' }) });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.issueUserToken('alice')).rejects.toThrow(/admin username\/password required/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('disables a user via the Gitea admin API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.disableUser('alice');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/admin/users/alice', {
      method: 'PATCH',
      headers: {
        Authorization: 'token admin-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prohibit_login: true })
    });
  });

  it('enables a user via the Gitea admin API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.enableUser('alice');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/admin/users/alice', {
      method: 'PATCH',
      headers: {
        Authorization: 'token admin-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prohibit_login: false })
    });
  });

  it('lists team members via the Gitea team API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 3, username: 'acme_bob', email: 'acme_bob@local.esl' }]
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.listTeamMembers(7)).resolves.toEqual([
      { id: 3, username: 'acme_bob', email: 'acme_bob@local.esl' }
    ]);

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/teams/7/members', {
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('changes a user password via the Gitea admin API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.changeUserPassword('admin', 'new-password');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/admin/users/admin', {
      method: 'PATCH',
      headers: {
        Authorization: 'token admin-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ login_name: 'admin', password: 'new-password' })
    });
  });

  it('checks whether an organization exists via the Gitea API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.organizationExists('esl-skills')).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/orgs/esl-skills', {
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('returns false when an organization does not exist', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.organizationExists('missing-org')).resolves.toBe(false);
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

  it('recognizes the administrator token via Gitea validation', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, username: 'eslroot', email: 'eslroot@local.esl' })
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any, 'eslroot');

    await expect(gitea.validateAdminUserToken('some-token')).resolves.toEqual({
      id: 1,
      username: 'eslroot',
      email: 'eslroot@local.esl'
    });
  });

  it('returns null when the token does not belong to the administrator', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 2, username: 'alice', email: 'alice@local.esl' })
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any, 'eslroot');

    await expect(gitea.validateAdminUserToken('alice-token')).resolves.toBeNull();
  });

  it('returns null when no administrator username is configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, username: 'eslroot', email: 'eslroot@local.esl' })
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.validateAdminUserToken('some-token')).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('changes the administrator password via the configured admin username', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any, 'eslroot');

    await gitea.changeAdminPassword('new-password');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/admin/users/eslroot', {
      method: 'PATCH',
      headers: {
        Authorization: 'token admin-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ login_name: 'eslroot', password: 'new-password' })
    });
  });

  it('throws when changing the administrator password without a configured username', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.changeAdminPassword('new-password')).rejects.toThrow(/admin username required/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('creates a Gitea organization for a tenant', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.createOrg('acme');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/orgs', {
      method: 'POST',
      headers: {
        Authorization: 'token admin-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: 'acme' })
    });
  });

  it('throws when creating a Gitea organization fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.createOrg('acme')).rejects.toThrow('Failed to create Gitea organization: boom');
  });

  it('deletes a Gitea organization', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.deleteOrg('acme');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/orgs/acme', {
      method: 'DELETE',
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('throws when deleting a Gitea organization fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.deleteOrg('acme')).rejects.toThrow('Failed to delete Gitea organization: boom');
  });

  it('lists Gitea organizations', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 1, name: 'acme' }, { id: 2, name: 'platform-ai' }]
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.listOrgs()).resolves.toEqual([
      { id: 1, name: 'acme' },
      { id: 2, name: 'platform-ai' }
    ]);
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/admin/orgs', {
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('throws when listing Gitea organizations fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.listOrgs()).rejects.toThrow('Failed to list Gitea organizations: boom');
  });

  it('creates a Gitea organization team with a repository permission level', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 7, name: 'all-readers', permission: 'read' })
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.createTeam('acme', 'all-readers', 'read')).resolves.toEqual({
      id: 7,
      name: 'all-readers',
      permission: 'read'
    });
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/orgs/acme/teams', {
      method: 'POST',
      headers: {
        Authorization: 'token admin-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: 'all-readers', permission: 'read' })
    });
  });

  it('throws when creating a Gitea team fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'invalid' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.createTeam('acme', 'all-readers', 'read')).rejects.toThrow(
      'Failed to create Gitea team: invalid'
    );
  });

  it('deletes a Gitea team by id', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.deleteTeam(7);

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/teams/7', {
      method: 'DELETE',
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('throws when deleting a Gitea team fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.deleteTeam(7)).rejects.toThrow('Failed to delete Gitea team: boom');
  });

  it('lists the teams of a Gitea organization', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 7, name: 'all-readers', permission: 'read' },
        { id: 8, name: 'all-writers', permission: 'write' }
      ]
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.listTeams('acme')).resolves.toEqual([
      { id: 7, name: 'all-readers', permission: 'read' },
      { id: 8, name: 'all-writers', permission: 'write' }
    ]);
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/orgs/acme/teams', {
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('throws when listing Gitea teams fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.listTeams('acme')).rejects.toThrow('Failed to list Gitea teams: boom');
  });

  it('adds a member to a Gitea team', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.addTeamMember(7, 'acme_bravo');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/teams/7/members/acme_bravo', {
      method: 'PUT',
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('throws when adding a Gitea team member fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'no user' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.addTeamMember(7, 'acme_bravo')).rejects.toThrow(
      'Failed to add Gitea team member: no user'
    );
  });

  it('removes a member from a Gitea team', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.removeTeamMember(7, 'acme_bravo');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/teams/7/members/acme_bravo', {
      method: 'DELETE',
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('throws when removing a Gitea team member fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.removeTeamMember(7, 'acme_bravo')).rejects.toThrow(
      'Failed to remove Gitea team member: boom'
    );
  });

  it('mounts a repository onto a Gitea team', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.addTeamRepo(7, 'acme', 'reviewer');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/teams/7/repos/acme/reviewer', {
      method: 'PUT',
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('throws when adding a Gitea team repository fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'forbidden' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.addTeamRepo(7, 'acme', 'reviewer')).rejects.toThrow(
      'Failed to add Gitea team repository: forbidden'
    );
  });

  it('removes a repository from a Gitea team', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.removeTeamRepo(7, 'acme', 'reviewer');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/teams/7/repos/acme/reviewer', {
      method: 'DELETE',
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('throws when removing a Gitea team repository fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.removeTeamRepo(7, 'acme', 'reviewer')).rejects.toThrow(
      'Failed to remove Gitea team repository: boom'
    );
  });

  it('removes a repository collaborator', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.removeCollaborator('acme', 'reviewer', 'alice');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://gitea:3000/api/v1/repos/acme/reviewer/collaborators/alice',
      {
        method: 'DELETE',
        headers: { Authorization: 'token admin-token' }
      }
    );
  });

  it('throws when removing a repository collaborator fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.removeCollaborator('acme', 'reviewer', 'alice')).rejects.toThrow(
      'Failed to remove Gitea repository collaborator: boom'
    );
  });

  it('lists repository collaborators', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 2, username: 'acme_alice', email: 'acme_alice@local.esl' },
        { id: 3, username: 'acme_bravo', email: 'acme_bravo@local.esl' }
      ]
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.listCollaborators('acme', 'reviewer')).resolves.toEqual([
      { id: 2, username: 'acme_alice', email: 'acme_alice@local.esl' },
      { id: 3, username: 'acme_bravo', email: 'acme_bravo@local.esl' }
    ]);
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/repos/acme/reviewer/collaborators', {
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('throws when listing repository collaborators fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.listCollaborators('acme', 'reviewer')).rejects.toThrow(
      'Failed to list Gitea repository collaborators: boom'
    );
  });

  it('lists the members of a Gitea organization', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 2, username: 'acme_admin', email: 'acme_admin@local.esl' }]
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.listOrgMembers('acme')).resolves.toEqual([
      { id: 2, username: 'acme_admin', email: 'acme_admin@local.esl' }
    ]);
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/orgs/acme/members', {
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('throws when listing Gitea organization members fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.listOrgMembers('acme')).rejects.toThrow(
      'Failed to list Gitea organization members: boom'
    );
  });

  it('deletes a Gitea user account', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.deleteUser('acme_bob');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/admin/users/acme_bob?purge=true', {
      method: 'DELETE',
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('throws when deleting a Gitea user account fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.deleteUser('acme_bob')).rejects.toThrow('Failed to delete Gitea user: boom');
  });

  it('removes a member from a Gitea organization', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await gitea.removeOrgMember('acme', 'acme_bob');

    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/orgs/acme/members/acme_bob', {
      method: 'DELETE',
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('throws when removing a Gitea organization member fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.removeOrgMember('acme', 'acme_bob')).rejects.toThrow(
      'Failed to remove Gitea organization member: boom'
    );
  });

  it('lists the teams that have access to a repository', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 7, name: 'frontend', permission: 'read' }]
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.listRepoTeams('acme', 'reviewer')).resolves.toEqual([
      { id: 7, name: 'frontend', permission: 'read' }
    ]);
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/repos/acme/reviewer/teams', {
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('throws when listing repository teams fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.listRepoTeams('acme', 'reviewer')).rejects.toThrow(
      'Failed to list Gitea repository teams: boom'
    );
  });

  it('checks whether a user belongs to a team', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.isTeamMember(7, 'acme_bob')).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/teams/7/members/acme_bob', {
      headers: { Authorization: 'token admin-token' }
    });
  });

  it('returns false when a user is not a team member', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.isTeamMember(7, 'acme_bob')).resolves.toBe(false);
  });

  it('checks whether a user is a repository collaborator', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.isCollaborator('acme', 'reviewer', 'acme_bob')).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://gitea:3000/api/v1/repos/acme/reviewer/collaborators/acme_bob',
      { headers: { Authorization: 'token admin-token' } }
    );
  });

  it('returns false when a user is not a collaborator', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.isCollaborator('acme', 'reviewer', 'acme_bob')).resolves.toBe(false);
  });

  it('reads the collaborator permission level', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ permission: 'write' })
    });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.getCollaboratorPermission('acme', 'reviewer', 'acme_bob')).resolves.toBe('write');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://gitea:3000/api/v1/repos/acme/reviewer/collaborators/acme_bob/permission',
      { headers: { Authorization: 'token admin-token' } }
    );
  });

  it('throws when reading the collaborator permission level fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const gitea = new GiteaService('http://gitea:3000', 'admin-token', mockFetch as any);

    await expect(gitea.getCollaboratorPermission('acme', 'reviewer', 'acme_bob')).rejects.toThrow(
      'Failed to get Gitea collaborator permission: boom'
    );
  });
});
