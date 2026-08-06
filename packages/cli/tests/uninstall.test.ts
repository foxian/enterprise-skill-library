import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureGitignore, executeUninstall } from '../src/commands/uninstall.js';
import {
  addLockEntry,
  addSkillDependency,
  initializeLocalStore,
  loadSkillsJson,
  loadSkillsLock,
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
    const skillDir = path.join(projectDir, '.skills', '@myorg', 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Test');
    await addSkillDependency(projectDir, '@myorg/my-skill', '^1.0.0');
    await addLockEntry(projectDir, '@myorg/my-skill', {
      version: '1.0.0',
      resolved: 'esl-skills/myorg_my-skill',
      integrity: ''
    });

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
    expect(content).toContain('.skills/');
    expect(content).toContain('.claude/skills/');
    expect(content).toContain('.agents/skills/');
    expect(content).toContain('.trae/skills/');
  });

  it('appends ESL entries if .gitignore exists without them', async () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n');

    await ensureGitignore(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.skills/');
  });

  it('does not duplicate entries if already present', async () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.skills/\n');

    await ensureGitignore(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    const matches = content.match(/\.skills\//g);
    expect(matches).toHaveLength(1);
  });
});
