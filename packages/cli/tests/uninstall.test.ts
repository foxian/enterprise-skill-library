import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureGitignore, executeUninstall } from '../src/commands/uninstall.js';
import { executeInstall } from '../src/commands/install.js';
import {
  addLockEntry,
  addSkillDependency,
  initializeLocalStore,
  loadSkillsJson,
  loadSkillsLock,
  loadInstallManifest,
  recordInstalledSkill,
  saveConfig
} from '@esl/core';

describe('esl uninstall', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-uninstall-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-uninstall-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude'] }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('removes skill directory and dependency entries', async () => {
    const skillDir = path.join(projectDir, '.eslib', 'skills', '@myorg', 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Test');
    await addSkillDependency(projectDir, '@myorg/my-skill', '^1.0.0');
    const lockEntry = {
      version: '1.0.0',
      resolved: 'esl-skills/myorg_my-skill',
      integrity: ''
    };
    await addLockEntry(projectDir, '@myorg/my-skill', lockEntry);
    await recordInstalledSkill(
      path.join(projectDir, '.eslib'),
      '@myorg/my-skill',
      lockEntry,
      '^1.0.0'
    );

    await executeUninstall('@myorg/my-skill', {
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });

    expect(fs.existsSync(skillDir)).toBe(false);
    const skills = await loadSkillsJson(projectDir);
    expect(skills.skills['@myorg/my-skill']).toBeUndefined();
    const lock = await loadSkillsLock(projectDir);
    expect(lock.skills['@myorg/my-skill']).toBeUndefined();
    const manifest = await loadInstallManifest(path.join(projectDir, '.eslib'));
    expect(manifest.skills['@myorg/my-skill']).toBeUndefined();
  });

  it('reports a conflicting tool link instead of printing success', async () => {
    const localSkillDir = path.join(projectDir, 'my-skill');
    fs.mkdirSync(localSkillDir);
    fs.writeFileSync(
      path.join(localSkillDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/my-skill',
        version: '1.0.0',
        description: 'My skill',
        author: 'tester'
      })
    );
    fs.writeFileSync(
      path.join(localSkillDir, 'SKILL.md'),
      '---\nname: my-skill\ndescription: My skill.\n---\n'
    );
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });
    const linkPath = path.join(projectDir, '.claude', 'skills', 'myorg_my-skill');
    fs.rmSync(linkPath, { recursive: true, force: true });
    fs.mkdirSync(linkPath, { recursive: true });
    fs.writeFileSync(path.join(linkPath, 'SKILL.md'), '# Manual\n');

    await expect(
      executeUninstall('@myorg/my-skill', {
        projectRoot: projectDir,
        homeDir
      })
    ).rejects.toThrow(/conflict/i);

    expect(fs.readFileSync(path.join(linkPath, 'SKILL.md'), 'utf8')).toBe('# Manual\n');
  });

  it('does not delete a Store directory without an install manifest record', async () => {
    const unrecordedDir = path.join(projectDir, '.eslib', 'skills', '@myorg', 'unrecorded-skill');
    fs.mkdirSync(unrecordedDir, { recursive: true });
    fs.writeFileSync(path.join(unrecordedDir, 'SKILL.md'), '# Unrecorded\n');

    await expect(
      executeUninstall('@myorg/unrecorded-skill', {
        projectRoot: projectDir,
        homeDir
      })
    ).rejects.toThrow(/not installed by ESL/i);

    expect(fs.readFileSync(path.join(unrecordedDir, 'SKILL.md'), 'utf8')).toBe('# Unrecorded\n');
  });
});

describe('ensureGitignore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-gitignore-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .gitignore with ESL entries if missing', async () => {
    await ensureGitignore(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toContain('.eslib/');
    expect(content).not.toContain('.skills/');
  });

  it('appends ESL entries if .gitignore exists without them', async () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n');

    await ensureGitignore(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.eslib/');
  });

  it('does not duplicate entries if already present', async () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.eslib/\n');

    await ensureGitignore(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    const matches = content.match(/\.eslib\//g);
    expect(matches).toHaveLength(1);
  });

  it('adds .eslib when the ESL marker already exists', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.gitignore'),
      '# ESL managed (do not edit)\n.skills/\n'
    );

    await ensureGitignore(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toContain('.eslib/');
  });
});
