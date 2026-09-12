import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { executeDeprecate } from '../src/commands/deprecate.js';

describe('esl deprecate', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-deprecate-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('marks a release as deprecated with a message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        skillName: '@alice/code-review',
        version: '1.0.0',
        deprecatedMessage: 'Use 1.1.0'
      })
    });

    const result = await executeDeprecate('@alice/code-review', '1.0.0', {
      homeDir,
      server: 'http://localhost:3000',
      message: 'Use 1.1.0',
      customFetch: fetchImpl as any
    });

    expect(result.deprecatedMessage).toBe('Use 1.1.0');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/alice/code-review/releases/1.0.0/deprecate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'token gitea-token' }),
        body: JSON.stringify({ message: 'Use 1.1.0' })
      })
    );
  });

  it('clears the mark when the message is empty', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ skillName: '@alice/code-review', version: '1.0.0', deprecatedMessage: null })
    });

    await executeDeprecate('@alice/code-review', '1.0.0', {
      homeDir,
      server: 'http://localhost:3000',
      message: '',
      customFetch: fetchImpl as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ message: '' }) })
    );
  });

  it('rejects a built-in identity', async () => {
    await expect(
      executeDeprecate('@builtin/esl-operator', '1.0.0', {
        homeDir,
        server: 'http://localhost:3000',
        message: 'nope',
        customFetch: vi.fn() as any
      })
    ).rejects.toThrow(/built-in/);
  });
});
