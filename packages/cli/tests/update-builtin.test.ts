import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBuiltinPackage, initializeLocalStore, loadSkillsJson, loadSkillsLock, saveConfig } from '@esl/core';
import { executeInstall } from '../src/commands/install.js';
import { executeUpdate } from '../src/commands/update.js';

describe('esl update built-in skill', () => {
  let homeDir: string;
  let projectDir: string;
  let builtinRoot: string;
  let sourceDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-update-home-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-update-proj-'));
    builtinRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-update-pkgs-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude'] }, { homeDir });

    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-update-src-'));
    fs.writeFileSync(
      path.join(sourceDir, 'SKILL.md'),
      '---\nname: esl-operator\ndescription: Operate the ESL CLI.\n---\n\n# ESL operator\n'
    );
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(builtinRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  async function buildPackages(version: string): Promise<void> {
    await buildBuiltinPackage({
      sourceDir,
      outputRoot: builtinRoot,
      identity: '@builtin/esl-operator',
      cliVersion: version
    });
  }

  it('refreshes a project built-in skill to the current CLI version via explicit update', async () => {
    await buildPackages('0.1.0');
    await executeInstall('@builtin/esl-operator', {
      projectRoot: projectDir,
      homeDir,
      builtinDir: builtinRoot,
      noAdapt: true
    });

    await buildPackages('0.2.0');
    const results = await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      builtinDir: builtinRoot,
      skillName: '@builtin/esl-operator'
    });

    expect(results).toEqual([
      { name: '@builtin/esl-operator', from: '0.1.0', to: '0.2.0' }
    ]);

    const lock = await loadSkillsLock(projectDir);
    expect(lock.skills['@builtin/esl-operator']?.version).toBe('0.2.0');
  });

  it('updates an installed built-in skill with no explicit name', async () => {
    await buildPackages('0.1.0');
    await executeInstall('@builtin/esl-operator', {
      projectRoot: projectDir,
      homeDir,
      builtinDir: builtinRoot,
      noAdapt: true
    });

    await buildPackages('0.3.0');
    const results = await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      builtinDir: builtinRoot
    });

    expect(results).toEqual([
      { name: '@builtin/esl-operator', from: '0.1.0', to: '0.3.0' }
    ]);
  });

  it('refreshes the global built-in copy with --global', async () => {
    await buildPackages('0.1.0');
    await executeInstall('@builtin/esl-operator', {
      homeDir,
      builtinDir: builtinRoot,
      global: true,
      noAdapt: true
    });

    await buildPackages('0.4.0');
    const results = await executeUpdate({
      homeDir,
      builtinDir: builtinRoot,
      global: true
    });

    expect(results).toEqual([
      { name: '@builtin/esl-operator', from: '0.1.0', to: '0.4.0' }
    ]);

    const globalRoot = path.join(homeDir, '.skill-library');
    const lock = await loadSkillsLock(globalRoot);
    expect(lock.skills['@builtin/esl-operator']?.version).toBe('0.4.0');
  });

  it('does not require a token when only built-in skills are installed', async () => {
    await buildPackages('0.1.0');
    await executeInstall('@builtin/esl-operator', {
      projectRoot: projectDir,
      homeDir,
      builtinDir: builtinRoot,
      noAdapt: true
    });

    const skillsJson = await loadSkillsJson(projectDir);
    expect(skillsJson.skills['@builtin/esl-operator']).toBe('builtin:esl-operator');
  });
});