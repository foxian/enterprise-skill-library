import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initDatabase, SkillRepository, SkillTeamGrantRepository } from '../src/db/database.js';

describe('skill team grants', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stores one permission per team and skill independently', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-team-grants-'));
    tempDirs.push(dir);
    const db = initDatabase(path.join(dir, 'test.db'));
    try {
      new SkillRepository(db).createSkill({
        name: '@acme/one',
        scope: 'acme',
        skillName: 'one',
        description: '',
        createdBy: 'alice',
        owner: 'alice',
        maintainers: ['alice'],
        visibility: 'private',
        gitRepoPath: 'acme/one'
      });
      new SkillRepository(db).createSkill({
        name: '@acme/two',
        scope: 'acme',
        skillName: 'two',
        description: '',
        createdBy: 'alice',
        owner: 'alice',
        maintainers: ['alice'],
        visibility: 'private',
        gitRepoPath: 'acme/two'
      });
      const grants = new SkillTeamGrantRepository(db);
      grants.set('@acme/one', 7, 'read');
      grants.set('@acme/two', 7, 'write');
      grants.set('@acme/one', 7, 'manage');

      expect(grants.list('@acme/one')).toEqual([{ teamId: 7, permission: 'manage' }]);
      expect(grants.list('@acme/two')).toEqual([{ teamId: 7, permission: 'write' }]);

      grants.removeByTeam(7);
      expect(grants.list('@acme/one')).toEqual([]);
      expect(grants.list('@acme/two')).toEqual([]);
    } finally {
      db.close();
    }
  });
});
