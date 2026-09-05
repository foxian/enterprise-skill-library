import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeInstall } from '../src/commands/install.js';
import { initializeLocalStore, loadSkillsJson, loadSkillsLock, saveConfig, saveCredentials } from '@esl/core';

describe('esl install (project-level)', () => {
  let projectDir: string;
  let homeDir: string;
  let localSkillDir: string;

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-install-proj-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-install-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude'] }, { homeDir });
    await saveCredentials({ token: 'gitea-token', loginAt: new Date().toISOString() }, { homeDir });

    localSkillDir = path.join(projectDir, 'my-local-skill');
    fs.mkdirSync(localSkillDir);
    fs.writeFileSync(
      path.join(localSkillDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/my-local-skill',
        version: '0.2.0',
        description: 'A local test skill',
        author: 'tester'
      })
    );
    fs.writeFileSync(
      path.join(localSkillDir, 'SKILL.md'),
      '---\nname: my-local-skill\ndescription: Local test skill.\n---\n\n# My Local Skill\n'
    );
    fs.mkdirSync(path.join(localSkillDir, 'scripts'));
    fs.mkdirSync(path.join(localSkillDir, 'references'));
    fs.mkdirSync(path.join(localSkillDir, 'assets'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('installs a skill from a local path to project .skills/', async () => {
    const targetDir = await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });

    const expectedDir = path.join(projectDir, '.skills', '@myorg', 'my-local-skill');
    expect(targetDir).toBe(expectedDir);
    expect(fs.existsSync(path.join(expectedDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(expectedDir, '.git'))).toBe(false);

    const skillsJson = await loadSkillsJson(projectDir);
    expect(skillsJson.skills['@myorg/my-local-skill']).toBe(`file:${localSkillDir}`);
  });

  it('runs adapt with namespaced runtime output by default', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir
    });

    const adaptedSkillMd = path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill', 'SKILL.md');
    expect(fs.readFileSync(adaptedSkillMd, 'utf8')).toContain('name: myorg:my-local-skill');
  });

  it('installs a local skill missing skill.json with @local identity and leaves the source untouched', async () => {
    const unpreparedSkillDir = path.join(projectDir, 'unprepared-skill');
    fs.mkdirSync(unpreparedSkillDir);
    fs.writeFileSync(
      path.join(unpreparedSkillDir, 'SKILL.md'),
      '---\nname: unprepared-skill\ndescription: Unprepared test skill.\n---\n\n# Unprepared Skill\n'
    );

    const targetDir = await executeInstall(unpreparedSkillDir, {
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });

    const expectedDir = path.join(projectDir, '.skills', '@local', 'unprepared-skill');
    expect(targetDir).toBe(expectedDir);
    expect(fs.existsSync(path.join(expectedDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(expectedDir, 'skill.json'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(expectedDir, 'skill.json'), 'utf8')).name).toBe(
      '@local/unprepared-skill'
    );
    expect(fs.existsSync(path.join(unpreparedSkillDir, 'skill.json'))).toBe(false);

    const skillsJson = await loadSkillsJson(projectDir);
    expect(skillsJson.skills['@local/unprepared-skill']).toBe(`file:${unpreparedSkillDir}`);
  });

  it('installs from server to project .skills/', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        cloneUrl: 'http://localhost:3000/git/esl-skills/alice_code-review.git',
        versions: ['0.1.0']
      })
    });
    const execFileAsync = vi.fn().mockImplementation(async (_command: string, args: string[]) => {
      if (args.includes('clone')) {
        const cloneDir = args.at(-1)!;
        fs.mkdirSync(cloneDir, { recursive: true });
        fs.writeFileSync(path.join(cloneDir, 'SKILL.md'), '---\nname: code-review\ndescription: Test.\n---\n');
        fs.writeFileSync(
          path.join(cloneDir, 'skill.json'),
          JSON.stringify({
            name: '@alice/code-review',
            version: '0.1.0',
            description: 'Test',
            author: 'tester'
          })
        );
        fs.mkdirSync(path.join(cloneDir, '.git'));
      }
      return { stdout: '', stderr: '' };
    });

    const targetDir = await executeInstall('@alice/code-review', {
      projectRoot: projectDir,
      homeDir,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any,
      noAdapt: true
    });

    const expectedDir = path.join(projectDir, '.skills', '@alice', 'code-review');
    expect(targetDir).toBe(expectedDir);
    expect(fs.existsSync(path.join(expectedDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(expectedDir, '.git'))).toBe(false);

    const skillsJson = await loadSkillsJson(projectDir);
    expect(skillsJson.skills['@alice/code-review']).toBe('^0.1.0');
    const lock = await loadSkillsLock(projectDir);
    expect(lock.skills['@alice/code-review']?.version).toBe('0.1.0');
  });

  it('fails a server-backed install with cross-account guidance on a 403', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"error":"Forbidden: read access required"}'
    });
    const execFileAsync = vi.fn();

    const error = await executeInstall('@acme/private-skill', {
      projectRoot: projectDir,
      homeDir,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any,
      noAdapt: true
    }).then(
      () => null,
      (e: Error) => e
    );

    expect(error).not.toBeNull();
    expect(error!.message).toContain('Failed to fetch skill info: {"error":"Forbidden: read access required"}');
    expect(error!.message).toMatch(/maintained by another account or organization/);
    expect(error!.message).toMatch(/esl login/);
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('fails fast when login is missing for a server-backed install', async () => {
    await saveCredentials({ token: null, loginAt: null }, { homeDir });
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executeInstall('@alice/code-review', {
        projectRoot: projectDir,
        homeDir,
        server: 'http://localhost:3000',
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any,
        noAdapt: true
      })
    ).rejects.toThrow('Missing token; run esl login or pass --token');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('fails fast when the login is expired for a server-backed install', async () => {
    await saveCredentials(
      { token: 'gitea-token', loginAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() },
      { homeDir }
    );
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executeInstall('@alice/code-review', {
        projectRoot: projectDir,
        homeDir,
        server: 'http://localhost:3000',
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any,
        noAdapt: true
      })
    ).rejects.toThrow('Login expired; run esl login to re-authenticate');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('fails clearly when no ESL Server is configured for a server-backed install', async () => {
    const fetchImpl = vi.fn();
    const execFileAsync = vi.fn();

    await expect(
      executeInstall('@alice/code-review', {
        projectRoot: projectDir,
        homeDir,
        customFetch: fetchImpl as any,
        execFileAsync: execFileAsync as any,
        noAdapt: true
      })
    ).rejects.toThrow('Missing server; run esl login or pass --server');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('installs from server to global with --global', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: '@alice/code-review',
        cloneUrl: 'http://localhost:3000/git/esl-skills/alice_code-review.git',
        versions: ['0.1.0']
      })
    });
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    const targetDir = await executeInstall('@alice/code-review', {
      homeDir,
      global: true,
      server: 'http://localhost:3000',
      customFetch: fetchImpl as any,
      execFileAsync: execFileAsync as any,
      noAdapt: true
    });

    expect(targetDir).toBe(path.normalize(path.join(homeDir, '.skill-library', 'skills', '@alice', 'code-review')));
  });

  it('installs a local path to the global store with --global', async () => {
    const targetDir = await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      global: true,
      noAdapt: true
    });

    const expectedDir = path.join(homeDir, '.skill-library', 'skills', '@myorg', 'my-local-skill');
    expect(targetDir).toBe(expectedDir);
    expect(fs.existsSync(path.join(expectedDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, '.skills', '@myorg', 'my-local-skill'))).toBe(false);

    const projectSkillsJson = await loadSkillsJson(projectDir);
    expect(projectSkillsJson.skills['@myorg/my-local-skill']).toBeUndefined();

    const globalSkillsJson = await loadSkillsJson(path.join(homeDir, '.skill-library'));
    expect(globalSkillsJson.skills['@myorg/my-local-skill']).toBe(`file:${localSkillDir}`);
  });
});
