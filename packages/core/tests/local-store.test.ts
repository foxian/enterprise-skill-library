import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeLocalStore, loadConfig, resolveLocalStorePaths, saveConfig } from '../src/index.js';

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
      registry: null,
      gitBase: null,
      token: null,
      username: null,
      tools: []
    });
    expect(JSON.parse(fs.readFileSync(paths.credentialsJson, 'utf8'))).toEqual({
      api_token: null
    });
  });

  it('saves and loads Gitea configuration', async () => {
    await initializeLocalStore({ homeDir });
    const config = {
      registry: 'http://skills.company.com/api',
      gitBase: 'http://skills.company.com/git',
      token: 'gitea_token_12345',
      username: 'zhangsan',
      tools: []
    };

    await saveConfig(config, { homeDir });
    const loaded = await loadConfig({ homeDir });

    expect(loaded).toEqual(config);
  });
});
