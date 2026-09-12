import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { executeReleaseDelete } from '../src/commands/release-delete.js';

describe('esl release-delete', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-release-delete-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('deletes a release once the version is confirmed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ deleted: true, name: '@alice/code-review', version: '1.0.0', dependents: [] })
    });

    const result = await executeReleaseDelete('@alice/code-review', '1.0.0', {
      homeDir,
      server: 'http://localhost:3000',
      confirm: '1.0.0',
      customFetch: fetchImpl as any
    });

    expect(result.deleted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/alice/code-review/releases/1.0.0/delete',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'token gitea-token' }),
        body: JSON.stringify({ confirm: '1.0.0' })
      })
    );
  });

  it('refuses to delete when the confirmation does not match the version', async () => {
    const fetchImpl = vi.fn();

    await expect(
      executeReleaseDelete('@alice/code-review', '1.0.0', {
        homeDir,
        server: 'http://localhost:3000',
        confirm: '2.0.0',
        customFetch: fetchImpl as any
      })
    ).rejects.toThrow(/1\.0\.0/);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes force through for a release other skills depend on', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ deleted: true, name: '@alice/code-review', version: '1.0.0', dependents: ['@alice/other'] })
    });

    await executeReleaseDelete('@alice/code-review', '1.0.0', {
      homeDir,
      server: 'http://localhost:3000',
      confirm: '1.0.0',
      force: true,
      customFetch: fetchImpl as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ confirm: '1.0.0', force: true }) })
    );
  });

  it('surfaces the dependent skills when the server refuses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => 'Release 1.0.0 is required by @alice/other; deleting it would break their installs.'
    });

    await expect(
      executeReleaseDelete('@alice/code-review', '1.0.0', {
        homeDir,
        server: 'http://localhost:3000',
        confirm: '1.0.0',
        customFetch: fetchImpl as any
      })
    ).rejects.toThrow(/@alice\/other/);
  });

  it('rejects a built-in identity', async () => {
    await expect(
      executeReleaseDelete('@builtin/esl-operator', '1.0.0', {
        homeDir,
        server: 'http://localhost:3000',
        confirm: '1.0.0',
        customFetch: vi.fn() as any
      })
    ).rejects.toThrow(/built-in/);
  });
});
