import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeUpdate } from '../src/commands/update.js';
import { initializeLocalStore, loadSkillsJson, loadSkillsLock, saveConfig, saveSkillsJson, saveSkillsLock } from '@esl/core';

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

  it('updates file: dependencies from their local skill source', async () => {
    const localSkillDir = path.join(projectDir, 'local-skill');
    fs.mkdirSync(localSkillDir);
    fs.writeFileSync(
      path.join(localSkillDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/local-skill',
        version: '0.2.0',
        description: 'A local test skill',
        author: 'tester'
      })
    );
    fs.writeFileSync(
      path.join(localSkillDir, 'SKILL.md'),
      '---\nname: local-skill\ndescription: Local test skill.\n---\n\n# Updated Local Skill\n'
    );
    await saveSkillsJson(projectDir, {
      skills: { '@myorg/local-skill': `file:${localSkillDir}` }
    });
    const installedDir = path.join(projectDir, '.skills', '@myorg', 'local-skill');
    fs.mkdirSync(installedDir, { recursive: true });
    fs.writeFileSync(path.join(installedDir, 'SKILL.md'), '# Old Local Skill\n');

    const result = await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });

    expect(result).toEqual([{ name: '@myorg/local-skill', from: 'local', to: '0.2.0' }]);
    expect(fs.readFileSync(path.join(installedDir, 'SKILL.md'), 'utf8')).toContain('# Updated Local Skill');
  });

  it('updates a specific file: dependency from its local skill source', async () => {
    const localSkillDir = path.join(projectDir, 'specific-local-skill');
    fs.mkdirSync(localSkillDir);
    fs.writeFileSync(
      path.join(localSkillDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/specific-local-skill',
        version: '0.4.0',
        description: 'A specific local test skill',
        author: 'tester'
      })
    );
    fs.writeFileSync(
      path.join(localSkillDir, 'SKILL.md'),
      '---\nname: specific-local-skill\ndescription: Specific local test skill.\n---\n\n# Updated Specific Local Skill\n'
    );
    await saveSkillsJson(projectDir, {
      skills: {
        '@myorg/specific-local-skill': `file:${localSkillDir}`,
        '@myorg/other-skill': '^1.0.0'
      }
    });

    const result = await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      skillName: '@myorg/specific-local-skill',
      noAdapt: true
    });

    const installedDir = path.join(projectDir, '.skills', '@myorg', 'specific-local-skill');
    expect(result).toEqual([{ name: '@myorg/specific-local-skill', from: 'local', to: '0.4.0' }]);
    expect(fs.readFileSync(path.join(installedDir, 'SKILL.md'), 'utf8')).toContain('# Updated Specific Local Skill');
  });

  it('updates global file: dependencies from the global manifest', async () => {
    const localSkillDir = path.join(projectDir, 'global-local-skill');
    fs.mkdirSync(localSkillDir);
    fs.writeFileSync(
      path.join(localSkillDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/global-local-skill',
        version: '0.3.0',
        description: 'A global local test skill',
        author: 'tester'
      })
    );
    fs.writeFileSync(
      path.join(localSkillDir, 'SKILL.md'),
      '---\nname: global-local-skill\ndescription: Global local test skill.\n---\n\n# Updated Global Local Skill\n'
    );
    const globalRoot = path.join(homeDir, '.skill-library');
    await saveSkillsJson(globalRoot, {
      skills: { '@myorg/global-local-skill': `file:${localSkillDir}` }
    });

    const result = await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      global: true,
      noAdapt: true
    });

    const installedDir = path.join(globalRoot, 'skills', '@myorg', 'global-local-skill');
    expect(result).toEqual([{ name: '@myorg/global-local-skill', from: 'local', to: '0.3.0' }]);
    expect(fs.readFileSync(path.join(installedDir, 'SKILL.md'), 'utf8')).toContain('# Updated Global Local Skill');

    const projectSkillsJson = await loadSkillsJson(projectDir);
    expect(projectSkillsJson.skills['@myorg/global-local-skill']).toBeUndefined();
    expect(fs.existsSync(path.join(projectDir, '.skills', '@myorg', 'global-local-skill'))).toBe(false);
  });

  it('fails clearly when a file: dependency local skill source is missing', async () => {
    const missingSkillDir = path.join(projectDir, 'missing-local-skill');
    await saveSkillsJson(projectDir, {
      skills: { '@myorg/missing-local-skill': `file:${missingSkillDir}` }
    });

    await expect(
      executeUpdate({
        projectRoot: projectDir,
        homeDir,
        skillName: '@myorg/missing-local-skill',
        noAdapt: true
      })
    ).rejects.toThrow(`Invalid skill package at ${missingSkillDir}`);
  });

  it('updates registry-backed skills from the global manifest', async () => {
    const globalRoot = path.join(homeDir, '.skill-library');
    await saveSkillsJson(globalRoot, {
      skills: { '@alice/code-review': '^1.0.0' }
    });
    await saveSkillsLock(globalRoot, {
      lockfileVersion: 1,
      skills: {
        '@alice/code-review': {
          version: '1.0.0',
          resolved: 'esl-skills/alice_code-review',
          integrity: ''
        }
      }
    });

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        gitRepoPath: 'esl-skills/alice_code-review',
        versions: ['1.1.0', '1.0.0']
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    const result = await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      global: true,
      registry: 'http://localhost:3000/api',
      gitBase: 'http://localhost:3001',
      token: 'gitea-token',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any,
      noAdapt: true
    });

    expect(result).toEqual([{ name: '@alice/code-review', from: '1.0.0', to: '1.1.0' }]);
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      [
        'clone',
        expect.stringContaining('/esl-skills/alice_code-review.git'),
        path.join(homeDir, '.skill-library', 'skills', '@alice', 'code-review')
      ]
    );

    const globalLock = await loadSkillsLock(globalRoot);
    expect(globalLock.skills['@alice/code-review']?.version).toBe('1.1.0');
    expect(fs.existsSync(path.join(projectDir, '.skills', '@alice', 'code-review'))).toBe(false);
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
