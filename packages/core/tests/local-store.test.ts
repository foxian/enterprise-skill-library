import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCredentials,
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

  it('resolves paths under ~/.eslib', () => {
    const paths = resolveLocalStorePaths({ homeDir });

    expect(paths.root).toBe(path.join(homeDir, '.eslib'));
    expect(paths.configJson).toBe(path.join(homeDir, '.eslib', 'config.json'));
    expect(paths.credentialsJson).toBe(path.join(homeDir, '.eslib', 'credentials.json'));
    expect(paths.cacheDir).toBe(path.join(homeDir, '.eslib', 'cache'));
    expect(paths.skillsDir).toBe(path.join(homeDir, '.eslib', 'skills'));
  });

  it('initializes directories and default JSON files', async () => {
    const paths = await initializeLocalStore({ homeDir });

    expect(fs.existsSync(paths.cacheDir)).toBe(true);
    expect(fs.existsSync(paths.skillsDir)).toBe(true);
    expect(JSON.parse(fs.readFileSync(paths.configJson, 'utf8'))).toEqual({
      server: null,
      username: null,
      organizations: null,
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
      organizations: [{ org: 'acme', identity: 'ordinary', isOwnerMember: false }],
      tools: []
    };

    await saveConfig(config, { homeDir });
    const loaded = await loadConfig({ homeDir });

    expect(loaded).toEqual(config);
  });

  it('strips legacy org/role fields and flags the config as pre-global-identity', async () => {
    await initializeLocalStore({ homeDir });
    // 旧版 CLI 写入的配置带 org/role（<org>_<username> 时代）
    const paths = resolveLocalStorePaths({ homeDir });
    fs.writeFileSync(
      paths.configJson,
      JSON.stringify({ server: 'http://skills.company.com', username: 'zhangsan', org: 'acme', role: 'member', tools: [] })
    );

    const loaded = await loadConfig({ homeDir });

    expect(loaded.legacyIdentity).toBe(true);
    expect(loaded).not.toHaveProperty('org');
    expect(loaded).not.toHaveProperty('role');
    // 组织列表缺失时按 null 处理
    expect(loaded.organizations).toBeNull();
  });

  it('flags a role-shaped organization list as legacy (ADR-0033 replaced role with isOrgManager)', async () => {
    await initializeLocalStore({ homeDir });
    const paths = resolveLocalStorePaths({ homeDir });
    fs.writeFileSync(
      paths.configJson,
      JSON.stringify({
        server: 'http://skills.company.com',
        username: 'zhangsan',
        organizations: [{ org: 'acme', role: 'org-admin' }],
        tools: []
      })
    );

    const loaded = await loadConfig({ homeDir });

    expect(loaded.legacyIdentity).toBe(true);
  });

  it('flags a two-tier isOrgManager-shaped list as legacy (ADR-0036 replaced it with identity)', async () => {
    await initializeLocalStore({ homeDir });
    const paths = resolveLocalStorePaths({ homeDir });
    fs.writeFileSync(
      paths.configJson,
      JSON.stringify({
        server: 'http://skills.company.com',
        username: 'zhangsan',
        organizations: [{ org: 'acme', isOrgManager: true }],
        tools: []
      })
    );

    const loaded = await loadConfig({ homeDir });

    expect(loaded.legacyIdentity).toBe(true);
  });

  it('does not flag a current identity-shaped organization list', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig(
      {
        server: 'http://skills.company.com',
        username: 'zhangsan',
        organizations: [{ org: 'acme', identity: 'owner', isOwnerMember: true }],
        tools: []
      },
      { homeDir }
    );

    const loaded = await loadConfig({ homeDir });

    expect(loaded.legacyIdentity).toBeFalsy();
  });

  it('clears credentials while keeping config intact', async () => {
    await initializeLocalStore({ homeDir });
    await saveConfig(
      { server: 'http://skills.company.com', username: 'zhangsan', organizations: [], tools: [] },
      { homeDir }
    );
    await saveCredentials({ token: 'secret_token_123', loginAt: new Date().toISOString() }, { homeDir });

    await clearCredentials({ homeDir });

    const credentials = await loadCredentials({ homeDir });
    expect(credentials.token).toBeNull();
    expect(credentials.loginAt).toBeNull();

    const config = await loadConfig({ homeDir });
    expect(config.server).toBe('http://skills.company.com');
    expect(config.username).toBe('zhangsan');
    expect(config.organizations).toEqual([]);
  });

  it('clears credentials even when no local store exists yet', async () => {
    await clearCredentials({ homeDir });

    const credentials = await loadCredentials({ homeDir });
    expect(credentials).toEqual({ token: null, loginAt: null });
  });
});
