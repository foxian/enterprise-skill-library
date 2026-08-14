import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, saveCredentials } from '@esl/core';
import {
  fetchWithTimeout,
  installTargetDir,
  requireFreshToken,
  resolveLoginTtlMs,
  resolveTimeoutMs
} from '../src/commands/network-options.js';

describe('network option paths', () => {
  it('keeps scope in the global skill install path', () => {
    const result = installTargetDir('@alice/code-review', {
      homeDir: 'C:\\temp\\esl-home'
    });

    expect(result).toBe(
      path.join('C:\\temp\\esl-home', '.skill-library', 'skills', '@alice', 'code-review')
    );
  });
});

describe('fetchWithTimeout', () => {
  it('adds an abort signal and resolves when fetch resolves', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });

    const res = await fetchWithTimeout(fetchImpl, 'http://example.com', {}, 1000);

    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('http://example.com', expect.objectContaining({ signal: expect.anything() }));
  });

  it('rejects with a clear message when the request times out', async () => {
    const fetchImpl = vi.fn((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    await expect(fetchWithTimeout(fetchImpl, 'http://example.com', {}, 5)).rejects.toThrow(
      'Request timed out after 5 ms'
    );
  });
});

describe('resolveTimeoutMs', () => {
  it('defaults to 30 seconds', () => {
    expect(resolveTimeoutMs()).toBe(30000);
  });

  it('reads ESL_HTTP_TIMEOUT from the environment', () => {
    vi.stubEnv('ESL_HTTP_TIMEOUT', '1000');
    expect(resolveTimeoutMs()).toBe(1000);
    vi.unstubAllEnvs();
  });
});

describe('resolveLoginTtlMs', () => {
  it('defaults to 30 days in milliseconds', () => {
    expect(resolveLoginTtlMs()).toBe(720 * 3_600_000);
  });

  it('reads ESL_LOGIN_TTL_HOURS from the environment', () => {
    vi.stubEnv('ESL_LOGIN_TTL_HOURS', '24');
    expect(resolveLoginTtlMs()).toBe(24 * 3_600_000);
    vi.unstubAllEnvs();
  });
});

describe('requireFreshToken', () => {
  it('returns the token when the login is fresh', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-fresh-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'tok', loginAt: new Date().toISOString() }, { homeDir });

    await expect(requireFreshToken({ homeDir })).resolves.toBe('tok');

    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('throws when the login is expired', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-expired-'));
    await initializeLocalStore({ homeDir });
    const past = new Date(Date.now() - 31 * 24 * 3_600_000).toISOString();
    await saveCredentials({ token: 'tok', loginAt: past }, { homeDir });

    await expect(requireFreshToken({ homeDir })).rejects.toThrow('Login expired; run esl login to re-authenticate');

    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('throws when loginAt is missing', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-missing-'));
    await initializeLocalStore({ homeDir });
    await saveCredentials({ token: 'tok' }, { homeDir });

    await expect(requireFreshToken({ homeDir })).rejects.toThrow('Login expired; run esl login to re-authenticate');

    fs.rmSync(homeDir, { recursive: true, force: true });
  });
});

