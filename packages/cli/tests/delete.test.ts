import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { executeDelete } from '../src/commands/delete.js';

describe('esl delete', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-delete-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('posts a delete request for the skill when confirmed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ deleted: true, name: '@platform-ai/reviewer', skillId: 'sk_1', releasesRemoved: 2 })
    });

    const result = await executeDelete('@platform-ai/reviewer', {
      homeDir,
      server: 'http://localhost:3000',
      yes: true,
      customFetch: fetchImpl as any
    });

    expect(result).toMatchObject({ deleted: true, name: '@platform-ai/reviewer', releasesRemoved: 2 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/platform-ai/reviewer/delete',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'token token' }),
        body: JSON.stringify({ confirm: '@platform-ai/reviewer' })
      })
    );
  });

  it('requires confirmation unless --yes is passed', async () => {
    const fetchImpl = vi.fn();

    await expect(
      executeDelete('@platform-ai/reviewer', {
        homeDir,
        server: 'http://localhost:3000',
        customFetch: fetchImpl as any
      })
    ).rejects.toThrow(/requires confirmation/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('cancels the deletion when the double confirmation is declined', async () => {
    const fetchImpl = vi.fn();

    await expect(
      executeDelete('@platform-ai/reviewer', {
        homeDir,
        server: 'http://localhost:3000',
        confirmInput: async () => false,
        customFetch: fetchImpl as any
      })
    ).rejects.toThrow(/Delete cancelled/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('proceeds after a successful double confirmation without --yes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ deleted: true, name: '@platform-ai/reviewer' })
    });

    const result = await executeDelete('@platform-ai/reviewer', {
      homeDir,
      server: 'http://localhost:3000',
      confirmInput: async () => true,
      customFetch: fetchImpl as any
    });

    expect(result).toMatchObject({ deleted: true });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('rejects built-in skills', async () => {
    await expect(
      executeDelete('@builtin/esl-operator', {
        homeDir,
        server: 'http://localhost:3000',
        yes: true,
        customFetch: vi.fn() as any
      })
    ).rejects.toThrow(/built-in skills cannot be deleted/);
  });
});
