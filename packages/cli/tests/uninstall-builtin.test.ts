import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBuiltinPackage, initializeLocalStore, loadSkillsJson, loadSkillsLock, saveConfig } from '@esl/core';
import { executeInstall } from '../src/commands/install.js';
import { executeUninstall } from '../src/commands/uninstall.js';
import { executeAdapt } from '../src/commands/adapt.js';

describe('esl built-in uninstall and adapt', () => {
  let homeDir: string;
  let projectDir: string;
  let builtinRoot: string;
  let sourceDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-uninstall-home-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-uninstall-proj-'));
    builtinRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-uninstall-pkgs-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude'] }, { homeDir });

    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-uninstall-src-'));
    fs.writeFileSync(
      path.join(sourceDir, 'SKILL.md'),
      '---\nname: esl-operator\ndescription: Operate the ESL CLI.\n---\n\n# ESL operator\n'
    );
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

  it('removes the built-in skill, its lock entry, and its adapted output on uninstall', async () => {
    await executeInstall('@builtin/esl-operator', {
      projectRoot: projectDir,
      homeDir,
      builtinDir: builtinRoot
    });
    const adaptedDir = path.join(projectDir, '.claude', 'skills', 'builtin_esl-operator');
    expect(fs.existsSync(adaptedDir)).toBe(true);

    await executeUninstall('@builtin/esl-operator', {
      projectRoot: projectDir,
      homeDir
    });

    expect(fs.existsSync(path.join(projectDir, '.skills', '@builtin', 'esl-operator'))).toBe(false);
    const skills = await loadSkillsJson(projectDir);
    expect(skills.skills['@builtin/esl-operator']).toBeUndefined();
    const lock = await loadSkillsLock(projectDir);
    expect(lock.skills['@builtin/esl-operator']).toBeUndefined();
    expect(fs.existsSync(adaptedDir)).toBe(false);
  });

  it('includes an installed built-in skill in esl adapt', async () => {
    await executeInstall('@builtin/esl-operator', {
      projectRoot: projectDir,
      homeDir,
      builtinDir: builtinRoot,
      noAdapt: true
    });

    const results = await executeAdapt({ directory: projectDir });

    expect(results.some((r) =>
      r.skills.some((s) => s.identity === '@builtin/esl-operator' && s.directoryName === 'builtin_esl-operator')
    )).toBe(true);
  });

  it('esl adapt --prune removes a stale adapted built-in output', async () => {
    await executeInstall('@builtin/esl-operator', {
      projectRoot: projectDir,
      homeDir,
      builtinDir: builtinRoot
    });
    const adaptedDir = path.join(projectDir, '.claude', 'skills', 'builtin_esl-operator');
    expect(fs.existsSync(adaptedDir)).toBe(true);

    await executeUninstall('@builtin/esl-operator', {
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });

    const results = await executeAdapt({ directory: projectDir, prune: true });
    expect(fs.existsSync(adaptedDir)).toBe(false);
    expect(results.some((r) => r.pruned.some((p) => p.identity === '@builtin/esl-operator'))).toBe(true);
  });
});