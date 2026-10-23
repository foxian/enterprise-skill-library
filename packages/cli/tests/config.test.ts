import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeLocalStore, loadConfig } from '@esl/core';
import { executeSetServer, resolveServer } from '../src/commands/config.js';

describe('esl config', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-config-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('sets the server in the saved config', async () => {
    await initializeLocalStore({ homeDir });

    await executeSetServer('http://localhost:4070', { homeDir });

    const config = await loadConfig({ homeDir });
    expect(config.server).toBe('http://localhost:4070');
  });

  it('resolves the server from the explicit option first', async () => {
    await initializeLocalStore({ homeDir });
    await executeSetServer('http://saved.example.com', { homeDir });

    const server = await resolveServer({ server: 'http://explicit.example.com', homeDir });

    expect(server).toBe('http://explicit.example.com');
  });

  it('resolves the server from the saved config when no option is given', async () => {
    await initializeLocalStore({ homeDir });
    await executeSetServer('http://saved.example.com', { homeDir });

    const server = await resolveServer({ homeDir });

    expect(server).toBe('http://saved.example.com');
  });

  it('uses the public cloud server when no server is configured or passed', async () => {
    await initializeLocalStore({ homeDir });
    vi.stubEnv('ESL_SERVER', '');

    await expect(resolveServer({ homeDir })).resolves.toBe('https://cloud.enterprise-skills.com/');
  });

  it('resolves ESL_SERVER before the saved config', async () => {
    await initializeLocalStore({ homeDir });
    await executeSetServer('http://saved.example.com', { homeDir });
    vi.stubEnv('ESL_SERVER', 'http://env.example.com');

    await expect(resolveServer({ homeDir })).resolves.toBe('http://env.example.com');
  });
});
