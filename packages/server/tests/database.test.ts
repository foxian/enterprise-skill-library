import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
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

  it('initializes schema and returns ownership metadata from getSkill and searchSkills', () => {
    const db = initDatabase(dbPath);
    const repo = new SkillRepository(db);

    repo.createSkill({
      name: '@alice/debugger',
      scope: 'alice',
      skillName: 'debugger',
      description: 'Debugging helper',
      createdBy: 'alice',
      owner: 'platform',
      maintainers: ['alice'],
      visibility: 'public',
      gitRepoPath: 'esl-skills/alice_debugger'
    });

    const expected = {
      name: '@alice/debugger',
      scope: 'alice',
      skillName: 'debugger',
      description: 'Debugging helper',
      createdBy: 'alice',
      owner: 'platform',
      maintainers: ['alice'],
      visibility: 'public',
      gitRepoPath: 'esl-skills/alice_debugger'
    };
    expect(repo.getSkill('@alice/debugger')).toEqual(expected);
    expect(repo.searchSkills('debugger')).toEqual([expected]);
    db.close();
  });

  it('migrates legacy skill rows without deleting data and is idempotent', () => {
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE skills (
        name TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        description TEXT NOT NULL,
        author TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'public',
        git_repo_path TEXT NOT NULL
      );
      INSERT INTO skills (
        name, scope, skill_name, description, author, visibility, git_repo_path
      ) VALUES (
        '@alice/debugger', 'alice', 'debugger', 'Debugging helper',
        'alice', 'public', 'esl-skills/alice_debugger'
      );
    `);
    legacyDb.close();

    const db = initDatabase(dbPath);
    const repo = new SkillRepository(db);
    expect(repo.getSkill('@alice/debugger')).toEqual({
      name: '@alice/debugger',
      scope: 'alice',
      skillName: 'debugger',
      description: 'Debugging helper',
      createdBy: 'alice',
      owner: 'platform',
      maintainers: [],
      visibility: 'public',
      gitRepoPath: 'esl-skills/alice_debugger'
    });
    db.close();

    const migratedAgain = initDatabase(dbPath);
    const columns = migratedAgain.pragma('table_info(skills)') as { name: string }[];
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['created_by', 'owner', 'maintainers_json'])
    );
    expect(new SkillRepository(migratedAgain).getSkill('@alice/debugger')?.createdBy).toBe('alice');
    migratedAgain.close();
  });
});
