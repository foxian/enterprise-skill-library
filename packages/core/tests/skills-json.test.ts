import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addLockEntry,
  addSkillDependency,
  loadSkillsJson,
  loadSkillsLock,
  removeSkillDependency,
  saveSkillsJson
} from '../src/store/skills-json.js';

describe('skills-json', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-skills-json-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty defaults when files do not exist', async () => {
    const skills = await loadSkillsJson(tmpDir);
    expect(skills).toEqual({ skills: {} });

    const lock = await loadSkillsLock(tmpDir);
    expect(lock).toEqual({ lockfileVersion: 1, skills: {} });
  });

  it('saves and loads .skills.json', async () => {
    const data = { skills: { '@scope/skill-a': '^1.0.0' }, tools: ['claude'] };
    await saveSkillsJson(tmpDir, data);

    const loaded = await loadSkillsJson(tmpDir);
    expect(loaded).toEqual(data);
  });

  it('adds a skill dependency', async () => {
    await addSkillDependency(tmpDir, '@scope/skill-a', '^1.0.0');
    await addSkillDependency(tmpDir, '@scope/skill-b', 'file:../my-skill');

    const loaded = await loadSkillsJson(tmpDir);
    expect(loaded.skills).toEqual({
      '@scope/skill-a': '^1.0.0',
      '@scope/skill-b': 'file:../my-skill'
    });
  });

  it('removes a skill dependency from both files', async () => {
    await addSkillDependency(tmpDir, '@scope/skill-a', '^1.0.0');
    await addLockEntry(tmpDir, '@scope/skill-a', {
      version: '1.0.0',
      resolved: 'esl-skills/scope_skill-a',
      integrity: 'sha256-abc'
    });

    await removeSkillDependency(tmpDir, '@scope/skill-a');

    const skills = await loadSkillsJson(tmpDir);
    expect(skills.skills['@scope/skill-a']).toBeUndefined();

    const lock = await loadSkillsLock(tmpDir);
    expect(lock.skills['@scope/skill-a']).toBeUndefined();
  });

  it('adds a lock entry', async () => {
    await addLockEntry(tmpDir, '@scope/skill-a', {
      version: '1.2.3',
      resolved: 'esl-skills/scope_skill-a',
      integrity: 'sha256-xyz'
    });

    const lock = await loadSkillsLock(tmpDir);
    expect(lock.skills['@scope/skill-a']).toEqual({
      version: '1.2.3',
      resolved: 'esl-skills/scope_skill-a',
      integrity: 'sha256-xyz'
    });
  });
});
