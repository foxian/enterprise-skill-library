import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  initializeLocalStore,
  loadConfig,
  loadCredentials,
  resolveLocalStorePaths,
  saveConfig,
  saveCredentials
} from '../src/index.js';

describe('local store', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-home-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('resolves paths under ~/.skill-library', () => {
    const paths = resolveLocalStorePaths({ homeDir });

    expect(paths.root).toBe(path.join(homeDir, '.skill-library'));
    expect(paths.configJson).toBe(path.join(homeDir, '.skill-library', 'config.json'));
    expect(paths.credentialsJson).toBe(path.join(homeDir, '.skill-library', 'credentials.json'));
    expect(paths.cacheDir).toBe(path.join(homeDir, '.skill-library', 'cache'));
    expect(paths.skillsDir).toBe(path.join(homeDir, '.skill-library', 'skills'));
  });

  it('initializes directories and default JSON files', async () => {
    const paths = await initializeLocalStore({ homeDir });

    expect(fs.existsSync(paths.cacheDir)).toBe(true);
    expect(fs.existsSync(paths.skillsDir)).toBe(true);
    expect(JSON.parse(fs.readFileSync(paths.configJson, 'utf8'))).toEqual({
      server: null,
      username: null,
      tools: []
    });
    expect(JSON.parse(fs.readFileSync(paths.credentialsJson, 'utf8'))).toEqual({
      token: null,
      loginAt: null
    });
  });

  it('saves and loads credentials separately from config', async () => {
    await initializeLocalStore({ homeDir });

    await saveCredentials({ token: 'secret_token_123' }, { homeDir });

    const credentials = await loadCredentials({ homeDir });
    expect(credentials).toEqual({ token: 'secret_token_123', loginAt: null });

    const config = await loadConfig({ homeDir });
    expect(config).not.toHaveProperty('token');
  });

  it.runIf(process.platform !== 'win32')('writes credentials with owner-only permissions', async () => {
    await initializeLocalStore({ homeDir });

    await saveCredentials({ token: 'secret_token_123' }, { homeDir });

    const credentialsPath = resolveLocalStorePaths({ homeDir }).credentialsJson;
    const mode = fs.statSync(credentialsPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('saves and loads ESL Server configuration', async () => {
    await initializeLocalStore({ homeDir });
    const config = {
      server: 'http://skills.company.com',
      username: 'zhangsan',
      tools: []
    };

    await saveConfig(config, { homeDir });
    const loaded = await loadConfig({ homeDir });

    expect(loaded).toEqual(config);
  });
});
