import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBuiltinPackage, initializeLocalStore, loadSkillsJson, loadSkillsLock, saveConfig } from '@esl/core';
import { retryPendingGlobalSync, syncGlobalBuiltinSkill } from '../src/commands/sync-builtin.js';

describe('esl built-in global sync (npm lifecycle)', () => {
  let homeDir: string;
  let builtinRoot: string;
  let sourceDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-sync-home-'));
    builtinRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-sync-pkgs-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude'] }, { homeDir });

    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-builtin-sync-src-'));
    fs.writeFileSync(
      path.join(sourceDir, 'SKILL.md'),
      '---\nname: esl-operator\ndescription: Operate the ESL CLI.\n---\n\n# ESL operator\n'
    );
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
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

  it('does not auto-install the built-in skill when it was never explicitly installed', async () => {
    await buildPackages('0.1.0');
    const result = await syncGlobalBuiltinSkill({ homeDir, builtinDir: builtinRoot });

    expect(result).toEqual({ synced: false, failed: false });
    const globalRoot = path.join(homeDir, '.skill-library');
    const skills = await loadSkillsJson(globalRoot);
    expect(skills.skills['@builtin/esl-operator']).toBeUndefined();
  });

  it('syncs the global built-in copy and adapt output when explicitly installed', async () => {
    await buildPackages('0.1.0');
    const globalRoot = path.join(homeDir, '.skill-library');
    const fsPromises = await import('node:fs/promises');
    const { addSkillDependency, addLockEntry } = await import('@esl/core');
    await addSkillDependency(globalRoot, '@builtin/esl-operator', 'builtin:esl-operator');
    await addLockEntry(globalRoot, '@builtin/esl-operator', {
      identity: '@builtin/esl-operator',
      version: '0.1.0',
      resolved: 'builtin:esl-operator',
      integrity: 'sha256-old',
      source: 'builtin'
    });

    await buildPackages('0.2.0');
    const result = await syncGlobalBuiltinSkill({ homeDir, builtinDir: builtinRoot });

    expect(result.synced).toBe(true);
    expect(result.failed).toBe(false);

    const lock = await loadSkillsLock(globalRoot);
    expect(lock.skills['@builtin/esl-operator']?.version).toBe('0.2.0');
    expect(fs.existsSync(path.join(globalRoot, 'skills', '@builtin', 'esl-operator', 'SKILL.md'))).toBe(true);
  });

  it('reports failure without throwing when the built-in package is missing', async () => {
    const globalRoot = path.join(homeDir, '.skill-library');
    const { addSkillDependency } = await import('@esl/core');
    await addSkillDependency(globalRoot, '@builtin/esl-operator', 'builtin:esl-operator');

    const result = await syncGlobalBuiltinSkill({ homeDir, builtinDir: builtinRoot });

    expect(result.failed).toBe(true);
    expect(result.synced).toBe(false);
  });

  it('retries a pending sync on the next CLI execution and clears the marker on success', async () => {
    await buildPackages('0.1.0');
    const globalRoot = path.join(homeDir, '.skill-library');
    const { addSkillDependency, addLockEntry } = await import('@esl/core');
    await addSkillDependency(globalRoot, '@builtin/esl-operator', 'builtin:esl-operator');
    await addLockEntry(globalRoot, '@builtin/esl-operator', {
      identity: '@builtin/esl-operator',
      version: '0.1.0',
      resolved: 'builtin:esl-operator',
      integrity: 'sha256-old',
      source: 'builtin'
    });

    const fsPromises = await import('node:fs/promises');
    await fsPromises.writeFile(path.join(globalRoot, '.builtin-sync-pending'), '2026-08-26 pending\n');

    await buildPackages('0.2.0');
    const result = await retryPendingGlobalSync({ homeDir, builtinDir: builtinRoot });

    expect(result.failed).toBe(false);
    const lock = await loadSkillsLock(globalRoot);
    expect(lock.skills['@builtin/esl-operator']?.version).toBe('0.2.0');
    await expect(fs.promises.access(path.join(globalRoot, '.builtin-sync-pending'))).rejects.toThrow();
  });
});