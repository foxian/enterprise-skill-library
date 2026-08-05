import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, SkillRepository } from '../src/db/database.js';
import { seedDevelopmentData } from '../src/seed.js';

describe('development seed', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-seed-'));
    dbPath = path.join(tmpDir, 'seed.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('seeds sample skill metadata idempotently', () => {
    seedDevelopmentData(dbPath);
    seedDevelopmentData(dbPath);

    const db = initDatabase(dbPath);
    const repo = new SkillRepository(db);
    const skill = repo.getSkill('@myorg/my-skill');

    expect(skill).toEqual({
      name: '@myorg/my-skill',
      scope: 'myorg',
      skillName: 'my-skill',
      description: 'Sample seeded skill',
      createdBy: 'dev',
      owner: 'platform',
      maintainers: ['dev'],
      visibility: 'public',
      gitRepoPath: 'myorg/my-skill'
    });
    expect(repo.getVersions('@myorg/my-skill')).toEqual(['0.1.0']);
    db.close();
  });
});
