import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBuiltinPackage, initializeLocalStore, loadSkillsJson, loadSkillsLock, saveConfig } from '@esl/core';
import { executeInstall } from '../src/commands/install.js';

describe('esl install @builtin/esl-operator (offline)', () => {
  let homeDir: string;
  let projectDir: string;
  let builtinRoot: string;
  let sourceDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-install-home-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-install-proj-'));
    builtinRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-install-pkgs-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude'] }, { homeDir });

    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-src-'));
    fs.writeFileSync(
      path.join(sourceDir, 'SKILL.md'),
      '---\nname: esl-operator\ndescription: Operate the ESL CLI.\n---\n\n# ESL operator\n'
    );
    fs.mkdirSync(path.join(sourceDir, 'references'));
    fs.writeFileSync(path.join(sourceDir, 'references', 'setup.md'), '# Setup\n');
    await buildBuiltinPackage({
      sourceDir,
      outputRoot: builtinRoot,
      identity: '@builtin/esl-operator',
      cliVersion: '0.1.0'
    });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(builtinRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it('installs the built-in skill offline into the project and adapts it', async () => {
    const targetDir = await executeInstall('@builtin/esl-operator', {
      projectRoot: projectDir,
      homeDir,
      builtinDir: builtinRoot
    });

    expect(targetDir).toBe(path.join(projectDir, '.skills', '@builtin', 'esl-operator'));
    expect(fs.existsSync(path.join(targetDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'references', 'setup.md'))).toBe(true);

    const adaptedMd = path.join(projectDir, '.claude', 'skills', 'builtin_esl-operator', 'SKILL.md');
    expect(fs.readFileSync(adaptedMd, 'utf8')).toContain('name: builtin:esl-operator');

    const skillsJson = await loadSkillsJson(projectDir);
    expect(skillsJson.skills['@builtin/esl-operator']).toBe('builtin:esl-operator');

    const lock = await loadSkillsLock(projectDir);
    expect(lock.skills['@builtin/esl-operator']).toEqual({
      identity: '@builtin/esl-operator',
      version: '0.1.0',
      resolved: 'builtin:esl-operator',
      source: 'builtin',
      integrity: expect.stringMatching(/^sha256-/)
    });
  });

  it('installs the built-in skill to the global store with --global', async () => {
    const targetDir = await executeInstall('@builtin/esl-operator', {
      projectRoot: projectDir,
      homeDir,
      builtinDir: builtinRoot,
      global: true,
      noAdapt: true
    });

    expect(targetDir).toBe(path.join(homeDir, '.skill-library', 'skills', '@builtin', 'esl-operator'));
    expect(fs.existsSync(path.join(targetDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, '.skills', '@builtin', 'esl-operator'))).toBe(false);
  });

  it('adapts a global built-in install into tool directories by default', async () => {
    await executeInstall('@builtin/esl-operator', {
      projectRoot: projectDir,
      homeDir,
      builtinDir: builtinRoot,
      global: true
    });

    const adaptedMd = path.join(homeDir, '.claude', 'skills', 'builtin_esl-operator', 'SKILL.md');
    expect(fs.readFileSync(adaptedMd, 'utf8')).toContain('name: builtin:esl-operator');
  });

  it('installs without requiring a token or server', async () => {
    const targetDir = await executeInstall('@builtin/esl-operator', {
      projectRoot: projectDir,
      homeDir,
      builtinDir: builtinRoot,
      noAdapt: true
    });

    expect(fs.existsSync(path.join(targetDir, 'skill.json'))).toBe(true);
  });

  it('rejects an unknown built-in identity', async () => {
    await expect(
      executeInstall('@builtin/does-not-exist', {
        projectRoot: projectDir,
        homeDir,
        builtinDir: builtinRoot,
        noAdapt: true
      })
    ).rejects.toThrow('Unknown built-in skill');
  });
});