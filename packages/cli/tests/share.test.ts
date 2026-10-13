import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeLocalStore, saveConfig, saveCredentials } from '@esl/core';
import {
  confirmClearGrants,
  executeShare,
  formatPermissionMatrix,
  resolveShareTarget
} from '../src/commands/share.js';

const MATRIX = {
  scope: 'acme',
  skillName: 'reviewer',
  sharedAllRead: true,
  sharedAllWrite: false,
  sharedAllManage: false,
  teams: [{ name: 'frontend', permission: 'read' }],
  members: [{ username: 'acme_bob', permission: 'write' }],
  skill: { name: '@acme/reviewer', visibility: 'private' }
};

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

  describe('目标解析', () => {
    it('不带目标旗标表示查看权限矩阵（只读路径）', () => {
      expect(resolveShareTarget({})).toBeUndefined();
    });

    it('组织全员默认只读，--write / --manage 逐级提升', () => {
      expect(resolveShareTarget({ all: true })).toEqual({ action: 'share_all_read' });
      expect(resolveShareTarget({ all: true, write: true })).toEqual({ action: 'share_all_write' });
      expect(resolveShareTarget({ all: true, manage: true })).toEqual({ action: 'share_all_manage' });
    });

    it('团队与成员授权按档位映射', () => {
      expect(resolveShareTarget({ team: 'frontend' })).toEqual({
        action: 'set_team',
        team: 'frontend',
        permission: 'read'
      });
      expect(resolveShareTarget({ team: 'frontend', write: true })).toEqual({
        action: 'set_team',
        team: 'frontend',
        permission: 'write'
      });
      expect(resolveShareTarget({ team: 'frontend', manage: true })).toEqual({
        action: 'set_team',
        team: 'frontend',
        permission: 'manage'
      });
      expect(resolveShareTarget({ user: 'acme_bob' })).toEqual({
        action: 'add_member',
        username: 'acme_bob',
        permission: 'read'
      });
      expect(resolveShareTarget({ user: 'acme_bob', manage: true })).toEqual({
        action: 'add_member',
        username: 'acme_bob',
        permission: 'manage'
      });
    });

    it('撤销团队与成员授权走 remove_team / remove_member', () => {
      expect(resolveShareTarget({ revokeTeam: 'frontend' })).toEqual({ action: 'remove_team', team: 'frontend' });
      expect(resolveShareTarget({ revokeUser: 'acme_bob' })).toEqual({ action: 'remove_member', username: 'acme_bob' });
    });

    // ADR-0062:清空显式授权是独立操作，不改变可见性
    it('清空全部显式授权映射为 reset_to_private', () => {
      expect(resolveShareTarget({ clearGrants: true })).toEqual({ action: 'reset_to_private' });
    });

    it('可见性切换独立于授权', () => {
      expect(resolveShareTarget({ visibility: 'public' })).toEqual({ action: 'set_visibility', visibility: 'public' });
      expect(resolveShareTarget({ visibility: 'private' })).toEqual({ action: 'set_visibility', visibility: 'private' });
      expect(() => resolveShareTarget({ visibility: 'internal' })).toThrow(/public or private/);
    });

    it('一次只能选一个目标', () => {
      expect(() => resolveShareTarget({ all: true, team: 'frontend' })).toThrow(/only one/i);
      expect(() => resolveShareTarget({ all: true, clearGrants: true })).toThrow(/only one/i);
      expect(() => resolveShareTarget({ visibility: 'public', user: 'acme_bob' })).toThrow(/only one/i);
      expect(() => resolveShareTarget({ team: 'frontend', revokeTeam: 'ops' })).toThrow(/only one/i);
    });

    it('--write / --manage 只作用于授权目标', () => {
      expect(() => resolveShareTarget({ user: 'acme_bob', write: true, manage: true })).toThrow(
        /only one permission level/
      );
      expect(() => resolveShareTarget({ visibility: 'public', write: true })).toThrow(/--all, --team, or --user/);
      expect(() => resolveShareTarget({ clearGrants: true, manage: true })).toThrow(/--all, --team, or --user/);
    });

    it('--force 只作用于 --clear-grants', () => {
      expect(resolveShareTarget({ clearGrants: true, force: true })).toEqual({ action: 'reset_to_private' });
      expect(() => resolveShareTarget({ all: true, force: true })).toThrow(/only applies to --clear-grants/);
    });
  });

  // ADR-0062:清空授权的确认提示必须表达范围，且不改变可见性
  describe('清空授权的确认', () => {
    it('--force 直接放行，不再打扰用户', async () => {
      const confirm = vi.fn();

      await confirmClearGrants({ identity: '@acme/reviewer', force: true, interactive: true, confirm });

      expect(confirm).not.toHaveBeenCalled();
    });

    it('非交互环境要求显式 --force', async () => {
      await expect(
        confirmClearGrants({ identity: '@acme/reviewer', interactive: false, confirm: vi.fn() })
      ).rejects.toThrow(/requires confirmation; pass --force/);
    });

    it('确认提示说清清空的是显式授权，且不改变可见性与角色权限', async () => {
      const confirm = vi.fn().mockResolvedValue(true);

      await confirmClearGrants({ identity: '@acme/reviewer', interactive: true, confirm });

      const question = confirm.mock.calls[0][0] as string;
      expect(question).toContain('explicit team and member grant');
      expect(question).toContain('Visibility');
      expect(question).toContain('role-based access');
    });

    it('用户拒绝时中止，不发请求', async () => {
      await expect(
        confirmClearGrants({
          identity: '@acme/reviewer',
          interactive: true,
          confirm: vi.fn().mockResolvedValue(false)
        })
      ).rejects.toThrow(/cancelled/);
    });
  });

  describe('请求发送', () => {
    it('shares with the whole organization for reading by default', async () => {
      const mockFetch = mockPermissionFetch();

      await executeShare('@acme/reviewer', { all: true, homeDir, customFetch: mockFetch as any });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://skills.company.com/api/skills/acme/reviewer/permissions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ authorization: 'token mock_token' }),
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

    // 组织全员档补齐管理级：此前 --all --manage 会被静默降级为只读
    it('shares with the whole organization as manage with --manage', async () => {
      const mockFetch = mockPermissionFetch();

      await executeShare('@acme/reviewer', { all: true, manage: true, homeDir, customFetch: mockFetch as any });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://skills.company.com/api/skills/acme/reviewer/permissions',
        expect.objectContaining({
          body: JSON.stringify({ action: 'share_all_manage' })
        })
      );
    });

    it('shares with a named team as read by default', async () => {
      const mockFetch = mockPermissionFetch();

      await executeShare('@acme/reviewer', { team: 'frontend', homeDir, customFetch: mockFetch as any });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://skills.company.com/api/skills/acme/reviewer/permissions',
        expect.objectContaining({
          body: JSON.stringify({ action: 'set_team', team: 'frontend', permission: 'read' })
        })
      );
    });

    it('shares with a named team as write with --write', async () => {
      const mockFetch = mockPermissionFetch();

      await executeShare('@acme/reviewer', { team: 'frontend', write: true, homeDir, customFetch: mockFetch as any });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://skills.company.com/api/skills/acme/reviewer/permissions',
        expect.objectContaining({
          body: JSON.stringify({ action: 'set_team', team: 'frontend', permission: 'write' })
        })
      );
    });

    it('shares with a named team as manage with --manage', async () => {
      const mockFetch = mockPermissionFetch();

      await executeShare('@acme/reviewer', { team: 'frontend', manage: true, homeDir, customFetch: mockFetch as any });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://skills.company.com/api/skills/acme/reviewer/permissions',
        expect.objectContaining({
          body: JSON.stringify({ action: 'set_team', team: 'frontend', permission: 'manage' })
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

    // SC-G1 (ADR-0025):--manage 授予协管权;与 --write 互斥
    it('grants manage permission to a member with --manage', async () => {
      const mockFetch = mockPermissionFetch();

      await executeShare('@acme/reviewer', { user: 'acme_bob', manage: true, homeDir, customFetch: mockFetch as any });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://skills.company.com/api/skills/acme/reviewer/permissions',
        expect.objectContaining({
          body: JSON.stringify({ action: 'add_member', username: 'acme_bob', permission: 'manage' })
        })
      );
    });

    it('revokes a team grant', async () => {
      const mockFetch = mockPermissionFetch();

      await executeShare('@acme/reviewer', { revokeTeam: 'frontend', homeDir, customFetch: mockFetch as any });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://skills.company.com/api/skills/acme/reviewer/permissions',
        expect.objectContaining({
          body: JSON.stringify({ action: 'remove_team', team: 'frontend' })
        })
      );
    });

    it('revokes a member grant', async () => {
      const mockFetch = mockPermissionFetch();

      await executeShare('@acme/reviewer', { revokeUser: 'acme_bob', homeDir, customFetch: mockFetch as any });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://skills.company.com/api/skills/acme/reviewer/permissions',
        expect.objectContaining({
          body: JSON.stringify({ action: 'remove_member', username: 'acme_bob' })
        })
      );
    });

    it('clears all explicit grants with --clear-grants', async () => {
      const mockFetch = mockPermissionFetch();

      await executeShare('@acme/reviewer', { clearGrants: true, homeDir, customFetch: mockFetch as any });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://skills.company.com/api/skills/acme/reviewer/permissions',
        expect.objectContaining({
          body: JSON.stringify({ action: 'reset_to_private' })
        })
      );
    });

    it('切换可见性打专用端点，不夹带授权动作', async () => {
      const mockFetch = mockPermissionFetch();

      await executeShare('@acme/reviewer', { visibility: 'public', homeDir, customFetch: mockFetch as any });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://skills.company.com/api/skills/acme/reviewer/visibility',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ authorization: 'token mock_token' }),
          body: JSON.stringify({ visibility: 'public' })
        })
      );
    });

    it('无目标旗标时只读拉取权限矩阵', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => MATRIX });

      const result = await executeShare('@acme/reviewer', { homeDir, customFetch: mockFetch as any });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://skills.company.com/api/skills/acme/reviewer/permissions',
        expect.objectContaining({
          headers: expect.objectContaining({ authorization: 'token mock_token' })
        })
      );
      // 查看是只读：不带 method: POST
      expect((mockFetch.mock.calls[0][1] as RequestInit).method).toBeUndefined();
      expect(result).toEqual({ kind: 'matrix', matrix: MATRIX });
    });

    it('surfaces server errors for forbidden shares', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden: manage permission required'
      });

      await expect(
        executeShare('@acme/reviewer', { all: true, homeDir, customFetch: mockFetch as any })
      ).rejects.toThrow('Failed to update skill permissions: Forbidden: manage permission required');
    });

    it('读取权限矩阵失败时如实报错', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden: no access to this private skill'
      });

      await expect(executeShare('@acme/reviewer', { homeDir, customFetch: mockFetch as any })).rejects.toThrow(
        'Failed to read skill permissions: Forbidden: no access to this private skill'
      );
    });
  });

  describe('权限矩阵呈现', () => {
    it('分别呈现可见性、全组织授权、团队与成员', () => {
      const text = formatPermissionMatrix(MATRIX);

      expect(text).toContain('@acme/reviewer');
      expect(text).toContain('Visibility: private');
      expect(text).toContain('Organization-wide authorization: read');
      expect(text).toContain('Teams: frontend (read)');
      expect(text).toContain('Members: acme_bob (write)');
    });

    it('全员管理档优先于读写与只读', () => {
      const text = formatPermissionMatrix({ ...MATRIX, sharedAllRead: false, sharedAllWrite: true, sharedAllManage: true });

      expect(text).toContain('Organization-wide authorization: manage');
    });

    it('无团队与成员授权时显式呈现为空', () => {
      const text = formatPermissionMatrix({ ...MATRIX, sharedAllRead: false, teams: [], members: [] });

      expect(text).toContain('Organization-wide authorization: none');
      expect(text).toContain('Teams: (none)');
      expect(text).toContain('Members: (none)');
    });
  });
});
