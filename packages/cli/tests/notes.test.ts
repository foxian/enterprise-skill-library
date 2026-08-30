import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { executeNotes } from '../src/commands/notes.js';

describe('esl notes', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-notes-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('posts the new release notes for the given version', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ skillName: '@platform-ai/reviewer', version: '1.1.0', notes: 'revised note' })
    });

    const result = await executeNotes('@platform-ai/reviewer', '1.1.0', {
      homeDir,
      server: 'http://localhost:3000',
      message: 'revised note',
      customFetch: fetchImpl as any
    });

    expect(result).toMatchObject({ version: '1.1.0', notes: 'revised note' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/platform-ai/reviewer/releases/1.1.0/notes',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'token token' }),
        body: JSON.stringify({ message: 'revised note' })
      })
    );
  });

  it('rejects built-in skills', async () => {
    await expect(
      executeNotes('@builtin/esl-operator', '1.0.0', {
        homeDir,
        server: 'http://localhost:3000',
        message: 'x',
        customFetch: vi.fn() as any
      })
    ).rejects.toThrow(/built-in skills have no releases/);
  });
});
