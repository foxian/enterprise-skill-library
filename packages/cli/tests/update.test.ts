import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeUpdate } from '../src/commands/update.js';
import { initializeLocalStore, saveConfig, saveSkillsJson, saveSkillsLock } from '@esl/core';

describe('esl update', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-update-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-update-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude'] }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('skips file: dependencies', async () => {
    await saveSkillsJson(projectDir, {
      skills: { '@myorg/local-skill': 'file:../local-skill' }
    });

    const result = await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });

    expect(result).toEqual([]);
  });

  it('reports already up-to-date skills', async () => {
    await saveSkillsJson(projectDir, {
      skills: { '@myorg/my-skill': '^1.0.0' }
    });
    await saveSkillsLock(projectDir, {
      lockfileVersion: 1,
      skills: {
        '@myorg/my-skill': { version: '1.2.0', resolved: 'esl-skills/myorg_my-skill', integrity: '' }
      }
    });

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@myorg/my-skill',
        gitRepoPath: 'esl-skills/myorg_my-skill',
        versions: ['1.2.0', '1.0.0']
      })
    });

    const result = await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      registry: 'http://localhost:3000/api',
      noAdapt: true,
      customFetch: fetchImpl as any
    });

    expect(result).toEqual([]);
  });
});
