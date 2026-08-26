import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeUpdate } from '../src/commands/update.js';
import { initializeLocalStore, loadSkillsJson, loadSkillsLock, saveConfig, saveCredentials, saveSkillsJson, saveSkillsLock } from '@esl/core';

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
          resolved: 'http://localhost:3000/git/esl-skills/alice_code-review.git',
          integrity: ''
        }
      }
    });

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        cloneUrl: 'http://localhost:3000/git/esl-skills/alice_code-review.git',
        versions: ['1.1.0', '1.0.0']
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });

    const result = await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      global: true,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any,
      noAdapt: true
    });

    expect(result).toEqual([{ name: '@alice/code-review', from: '1.0.0', to: '1.1.0' }]);
    expect(execFileAsync).toHaveBeenCalledWith(
      'git',
      [
        '-c',
        'http.extraHeader=Authorization: Bearer gitea-token',
        'clone',
        'http://localhost:3000/git/esl-skills/alice_code-review.git',
        path.join(homeDir, '.skill-library', 'skills', '@alice', 'code-review')
      ]
    );

    const globalLock = await loadSkillsLock(globalRoot);
    expect(globalLock.skills['@alice/code-review']?.version).toBe('1.1.0');
    expect(fs.existsSync(path.join(projectDir, '.skills', '@alice', 'code-review'))).toBe(false);
  });

  it('migrates an installed skill after a server-side rename even when the version is unchanged', async () => {
    await saveSkillsJson(projectDir, {
      skills: { '@alice/code-review': '^1.0.0' }
    });
    await saveSkillsLock(projectDir, {
      lockfileVersion: 1,
      skills: {
        '@alice/code-review': {
          skillId: 'sk_test',
          identity: '@alice/code-review',
          version: '1.0.0',
          resolved: 'http://localhost:3000/api/packages/sk_test/1.0.0/package.json',
          integrity: ''
        }
      }
    });
    const oldDirectory = path.join(projectDir, '.skills', 'alice_code-review');
    fs.mkdirSync(oldDirectory, { recursive: true });
    fs.writeFileSync(path.join(oldDirectory, 'SKILL.md'), '# Installed skill\n');

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review-renamed',
        currentName: '@alice/code-review-renamed',
        versions: ['1.0.0']
      })
    });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });

    const result = await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any,
      noAdapt: true
    });

    expect(result).toEqual([{ name: '@alice/code-review-renamed', from: '1.0.0', to: '1.0.0' }]);
    expect(fs.existsSync(oldDirectory)).toBe(false);
    expect(fs.readFileSync(path.join(projectDir, '.skills', 'alice_code-review-renamed', 'SKILL.md'), 'utf8'))
      .toContain('# Installed skill');
    const skills = await loadSkillsJson(projectDir);
    expect(skills.skills['@alice/code-review']).toBeUndefined();
    expect(skills.skills['@alice/code-review-renamed']).toBe('^1.0.0');
    const lock = await loadSkillsLock(projectDir);
    expect(lock.skills['@alice/code-review']).toBeUndefined();
    expect(lock.skills['@alice/code-review-renamed']?.identity).toBe('@alice/code-review-renamed');
  });

  it('fails fast when the login is expired and registry skills are present', async () => {
    await saveSkillsJson(projectDir, {
      skills: { '@alice/code-review': '^1.0.0' }
    });
    await saveSkillsLock(projectDir, {
      lockfileVersion: 1,
      skills: {
        '@alice/code-review': {
          version: '1.0.0',
          resolved: 'http://localhost:3000/git/esl-skills/alice_code-review.git',
          integrity: ''
        }
      }
    });
    const expiredLoginAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await saveCredentials({ token: 'gitea-token', loginAt: expiredLoginAt }, { homeDir });

    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

    await expect(
      executeUpdate({
        projectRoot: projectDir,
        homeDir,
        server: 'http://localhost:3000',
        customFetch: fetchImpl as any,
        noAdapt: true
      })
    ).rejects.toThrow('Login expired; run esl login to re-authenticate');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails clearly when registry skills are present and no ESL Server is configured', async () => {
    await saveSkillsJson(projectDir, {
      skills: { '@alice/code-review': '^1.0.0' }
    });
    await saveSkillsLock(projectDir, {
      lockfileVersion: 1,
      skills: {
        '@alice/code-review': {
          version: '1.0.0',
          resolved: 'http://localhost:3000/git/esl-skills/alice_code-review.git',
          integrity: ''
        }
      }
    });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });
    const fetchImpl = vi.fn();

    await expect(
      executeUpdate({
        projectRoot: projectDir,
        homeDir,
        customFetch: fetchImpl as any,
        noAdapt: true
      })
    ).rejects.toThrow('Missing server; run esl login or pass --server');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails fast when login is missing and registry skills are present', async () => {
    await saveSkillsJson(projectDir, {
      skills: { '@alice/code-review': '^1.0.0' }
    });
    await saveSkillsLock(projectDir, {
      lockfileVersion: 1,
      skills: {
        '@alice/code-review': {
          version: '1.0.0',
          resolved: 'http://localhost:3000/git/esl-skills/alice_code-review.git',
          integrity: ''
        }
      }
    });
    const fetchImpl = vi.fn();

    await expect(
      executeUpdate({
        projectRoot: projectDir,
        homeDir,
        server: 'http://localhost:3000',
        customFetch: fetchImpl as any,
        noAdapt: true
      })
    ).rejects.toThrow('Missing token; run esl login or pass --token');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('updates file: dependencies without requiring a fresh login', async () => {
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
    const expiredLoginAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await saveCredentials({ token: 'gitea-token', loginAt: expiredLoginAt }, { homeDir });
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

  it('reports already up-to-date skills', async () => {
    await saveSkillsJson(projectDir, {
      skills: { '@myorg/my-skill': '^1.0.0' }
    });
    await saveSkillsLock(projectDir, {
      lockfileVersion: 1,
      skills: {
        '@myorg/my-skill': {
          version: '1.2.0',
          resolved: 'http://localhost:3000/git/esl-skills/myorg_my-skill.git',
          integrity: ''
        }
      }
    });

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@myorg/my-skill',
        cloneUrl: 'http://localhost:3000/git/esl-skills/myorg_my-skill.git',
        versions: ['1.2.0', '1.0.0']
      })
    });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });

    const result = await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      server: 'http://localhost:3000',
      noAdapt: true,
      customFetch: fetchImpl as any
    });

    expect(result).toEqual([]);
  });
});
