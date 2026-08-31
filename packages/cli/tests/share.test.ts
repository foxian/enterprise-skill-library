import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeLocalStore, saveConfig, saveCredentials } from '@esl/core';
import { executeShare, resolveShareTarget } from '../src/commands/share.js';

describe('esl share', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-share-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ server: 'http://skills.company.com', username: 'acme_alice', org: 'acme' }, { homeDir });
    await saveCredentials({ token: 'mock_token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function mockPermissionFetch() {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ scope: 'acme', skillName: 'reviewer', sharedAllRead: true, teams: [], members: [] })
    });
  }

  it('shares with the whole organization for reading by default', async () => {
    const mockFetch = mockPermissionFetch();

    await executeShare('@acme/reviewer', { all: true, homeDir, customFetch: mockFetch as any });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/skills/acme/reviewer/permissions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'token mock_token' }),
        body: JSON.stringify({ action: 'share_all_read' })
      })
    );
  });

  it('shares with the whole organization for writing with --write', async () => {
    const mockFetch = mockPermissionFetch();

    await executeShare('@acme/reviewer', { all: true, write: true, homeDir, customFetch: mockFetch as any });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/skills/acme/reviewer/permissions',
      expect.objectContaining({
        body: JSON.stringify({ action: 'share_all_write' })
      })
    );
  });

  it('shares with a named team', async () => {
    const mockFetch = mockPermissionFetch();

    await executeShare('@acme/reviewer', { team: 'frontend', homeDir, customFetch: mockFetch as any });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/skills/acme/reviewer/permissions',
      expect.objectContaining({
        body: JSON.stringify({ action: 'add_team', team: 'frontend' })
      })
    );
  });

  it('grants write access to a member with --user --write', async () => {
    const mockFetch = mockPermissionFetch();

    await executeShare('@acme/reviewer', { user: 'acme_bob', write: true, homeDir, customFetch: mockFetch as any });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/skills/acme/reviewer/permissions',
      expect.objectContaining({
        body: JSON.stringify({ action: 'add_member', username: 'acme_bob', permission: 'write' })
      })
    );
  });

  it('grants read access to a member by default', async () => {
    const mockFetch = mockPermissionFetch();

    await executeShare('@acme/reviewer', { user: 'acme_bob', homeDir, customFetch: mockFetch as any });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/skills/acme/reviewer/permissions',
      expect.objectContaining({
        body: JSON.stringify({ action: 'add_member', username: 'acme_bob', permission: 'read' })
      })
    );
  });

  it('resets the skill to private with --reset', async () => {
    const mockFetch = mockPermissionFetch();

    await executeShare('@acme/reviewer', { reset: true, homeDir, customFetch: mockFetch as any });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/skills/acme/reviewer/permissions',
      expect.objectContaining({
        body: JSON.stringify({ action: 'reset_to_private' })
      })
    );
  });

  it('requires exactly one sharing target', () => {
    expect(() => resolveShareTarget({})).toThrow(/--all, --team, --user, or --reset/);
    expect(() => resolveShareTarget({ all: true, team: 'frontend' })).toThrow(/only one/i);
    expect(() => resolveShareTarget({ all: true, reset: true })).toThrow(/only one/i);
  });

  it('surfaces server errors for forbidden shares', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden: skill owner or organization administrator required'
    });

    await expect(
      executeShare('@acme/reviewer', { all: true, homeDir, customFetch: mockFetch as any })
    ).rejects.toThrow('Failed to update skill permissions: Forbidden: skill owner or organization administrator required');
  });
});
