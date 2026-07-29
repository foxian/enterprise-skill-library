import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, SkillRepository } from '../src/db/database.js';

describe('API Server Database', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-db-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes schema and manages skills', () => {
    const db = initDatabase(dbPath);
    const repo = new SkillRepository(db);

    repo.createSkill({
      name: '@myorg/debugging-helper',
      scope: 'myorg',
      skillName: 'debugging-helper',
      description: 'Systematic debugging skill',
      author: 'zhangsan',
      visibility: 'public',
      gitRepoPath: 'myorg/debugging-helper'
    });

    const skill = repo.getSkill('@myorg/debugging-helper');
    expect(skill).toBeDefined();
    expect(skill?.name).toBe('@myorg/debugging-helper');
    expect(skill?.author).toBe('zhangsan');
    db.close();
  });
});
