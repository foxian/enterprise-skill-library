import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import { executeInfo } from '../src/commands/info.js';

describe('esl info authentication', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-info-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('sends the stored token with the info request when credentials exist', async () => {
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@acme/code-review', versions: ['1.0.0'] })
    });

    await executeInfo('@acme/code-review', {
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/%40acme%2Fcode-review',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'token gitea-token' })
      })
    );
  });

  it('stays anonymous when no credentials exist', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@acme/code-review', versions: ['1.0.0'] })
    });

    await executeInfo('@acme/code-review', {
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/%40acme%2Fcode-review',
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.anything() })
      })
    );
  });

  it('stays anonymous when the stored login is expired', async () => {
    await initializeLocalStore({ homeDir });
    const expiredLoginAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await saveCredentials({ token: 'gitea-token', loginAt: expiredLoginAt }, { homeDir });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@acme/code-review', versions: ['1.0.0'] })
    });

    await executeInfo('@acme/code-review', {
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/skills/%40acme%2Fcode-review',
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.anything() })
      })
    );
  });

  it('wraps a 403 with cross-account guidance', async () => {
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"error":"Forbidden: read access required"}'
    });

    const error = await executeInfo('@acme/private-skill', {
      server: 'http://localhost:3000',
      homeDir,
      customFetch: fetchImpl as any
    }).then(
      () => null,
      (e: Error) => e
    );

    expect(error).not.toBeNull();
    expect(error!.message).toContain('Failed to fetch skill info: {"error":"Forbidden: read access required"}');
    expect(error!.message).toMatch(/maintained by another account or organization/);
    expect(error!.message).toMatch(/esl login/);
  });

  it('leaves non-403 failures unadorned', async () => {
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom'
    });

    await expect(
      executeInfo('@acme/code-review', {
        server: 'http://localhost:3000',
        homeDir,
        customFetch: fetchImpl as any
      })
    ).rejects.toThrow(/^Failed to fetch skill info: boom$/);
  });
});
