import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, OrgApplicationRepository, PlatformSettingsRepository, SkillRepository } from '../src/db/database.js';

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

  it('creates an unreleased server skill with a stable Skill ID', () => {
    const db = initDatabase(dbPath);
    const repo = new SkillRepository(db);

    const skill = repo.createServerSkill({
      name: '@platform-ai/reviewer',
      scope: 'platform-ai',
      skillName: 'reviewer',
      description: 'Shared reviewer',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: ['alice'],
      visibility: 'private',
      gitRepoPath: 'platform-ai/reviewer'
    });

    expect(skill.skillId).toMatch(/^sk_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(skill.status).toBe('active-unreleased');
    expect(repo.getSkillById(skill.skillId)?.name).toBe('@platform-ai/reviewer');
    db.close();
  });

  it('renames a skill while preserving its release history', () => {
    const db = initDatabase(dbPath);
    const repo = new SkillRepository(db);
    const skill = repo.createServerSkill({
      name: '@platform-ai/reviewer',
      scope: 'platform-ai',
      skillName: 'reviewer',
      description: 'Shared reviewer',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: ['alice'],
      visibility: 'private',
      gitRepoPath: 'platform-ai/reviewer'
    });
    repo.createRelease({
      skillId: skill.skillId!,
      skillName: skill.name,
      version: '1.0.0',
      sourceCommit: 'abc123',
      packagePath: '/packages/reviewer.json',
      checksum: 'sha256-abc',
      releaseManifest: {
        schemaVersion: 1,
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      },
      dependencyLock: {},
      createdBy: 'alice'
    });

    const renamed = repo.renameSkill(
      '@platform-ai/reviewer',
      '@platform-ai/reviewer-pro',
      'reviewer-pro',
      'platform-ai/reviewer-pro'
    );

    expect(renamed.name).toBe('@platform-ai/reviewer-pro');
    expect(repo.getRelease('@platform-ai/reviewer-pro', '1.0.0')?.skillId).toBe(skill.skillId);
    expect(repo.resolveRedirect('@platform-ai/reviewer')).toEqual({
      skillId: skill.skillId,
      currentName: '@platform-ai/reviewer-pro'
    });
    db.close();
  });

  it('completely deletes a skill and all its related rows', () => {
    const db = initDatabase(dbPath);
    const repo = new SkillRepository(db);

    const skill = repo.createServerSkill({
      name: '@alice/debugger',
      scope: 'alice',
      skillName: 'debugger',
      description: 'Debugging helper',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: ['alice'],
      visibility: 'private',
      gitRepoPath: 'esl-skills/debugger',
      status: 'active-published'
    });
    repo.addVersion('@alice/debugger', '1.0.0');
    repo.createRelease({
      skillId: skill.skillId!,
      skillName: '@alice/debugger',
      version: '1.0.0',
      sourceCommit: 'abc123',
      packagePath: path.join(tmpDir, 'pkg.json'),
      checksum: 'sha256-abc',
      releaseManifest: { schemaVersion: 1, license: 'MIT', keywords: [], compatibility: {}, dependencies: {} },
      dependencyLock: {},
      createdBy: 'alice'
    });

    const result = repo.deleteSkill('@alice/debugger');

    expect(result.skillId).toBe(skill.skillId);
    expect(result.releases).toBe(1);
    expect(repo.getSkill('@alice/debugger')).toBeUndefined();
    expect(repo.getReleases('@alice/debugger')).toEqual([]);
    expect(repo.getVersions('@alice/debugger')).toEqual([]);
    db.close();
  });

  it('persists release notes on a release and returns them', () => {
    const db = initDatabase(dbPath);
    const repo = new SkillRepository(db);

    const skill = repo.createServerSkill({
      name: '@alice/debugger',
      scope: 'alice',
      skillName: 'debugger',
      description: 'Debugging helper',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: ['alice'],
      visibility: 'private',
      gitRepoPath: 'esl-skills/debugger'
    });
    repo.createRelease({
      skillId: skill.skillId!,
      skillName: '@alice/debugger',
      version: '1.0.0',
      sourceCommit: 'abc123',
      packagePath: path.join(tmpDir, 'pkg.json'),
      checksum: 'sha256-abc',
      releaseManifest: { schemaVersion: 1, license: 'MIT', keywords: [], compatibility: {}, dependencies: {} },
      dependencyLock: {},
      createdBy: 'alice',
      notes: '- fix: dead-link regex\n- feat: docx batch'
    });

    const release = repo.getRelease('@alice/debugger', '1.0.0');
    expect(release?.notes).toBe('- fix: dead-link regex\n- feat: docx batch');
    expect(repo.getReleases('@alice/debugger')[0]?.notes).toBe('- fix: dead-link regex\n- feat: docx batch');
    db.close();
  });

  it('updates release notes after publishing', () => {
    const db = initDatabase(dbPath);
    const repo = new SkillRepository(db);

    const skill = repo.createServerSkill({
      name: '@alice/debugger',
      scope: 'alice',
      skillName: 'debugger',
      description: 'Debugging helper',
      createdBy: 'alice',
      owner: 'alice',
      maintainers: ['alice'],
      visibility: 'private',
      gitRepoPath: 'esl-skills/debugger'
    });
    repo.createRelease({
      skillId: skill.skillId!,
      skillName: '@alice/debugger',
      version: '1.0.0',
      sourceCommit: 'abc123',
      packagePath: path.join(tmpDir, 'pkg.json'),
      checksum: 'sha256-abc',
      releaseManifest: { schemaVersion: 1, license: 'MIT', keywords: [], compatibility: {}, dependencies: {} },
      dependencyLock: {},
      createdBy: 'alice',
      notes: 'original note'
    });

    const updated = repo.updateReleaseNotes('@alice/debugger', '1.0.0', 'revised note');
    expect(updated?.notes).toBe('revised note');
    expect(repo.getRelease('@alice/debugger', '1.0.0')?.notes).toBe('revised note');
    expect(repo.updateReleaseNotes('@alice/debugger', '9.9.9', 'x')).toBeUndefined();
    db.close();
  });

  it('creates the org_applications and platform_settings tables with the designed columns', () => {
    const db = initDatabase(dbPath);

    const applicationColumns = db.pragma('table_info(org_applications)') as { name: string }[];
    expect(applicationColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'id',
        'org_name',
        'admin_display_name',
        'hashed_password',
        'status',
        'created_at',
        'updated_at'
      ])
    );

    const settingColumns = db.pragma('table_info(platform_settings)') as { name: string }[];
    expect(settingColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['key', 'value', 'updated_at'])
    );
    db.close();
  });

  it('seeds the default org_registration_mode setting on first initialization', () => {
    const db = initDatabase(dbPath);
    const settings = new PlatformSettingsRepository(db);

    expect(settings.getSetting('org_registration_mode')).toBe('auto');
    db.close();
  });

  it('keeps customized platform settings when re-initializing the database', () => {
    const db = initDatabase(dbPath);
    const settings = new PlatformSettingsRepository(db);
    settings.setSetting('org_registration_mode', 'manual');
    db.close();

    const reopened = initDatabase(dbPath);
    expect(new PlatformSettingsRepository(reopened).getSetting('org_registration_mode')).toBe('manual');
    reopened.close();
  });

  it('creates, updates, and deletes an org application', () => {
    const db = initDatabase(dbPath);
    const applications = new OrgApplicationRepository(db);

    const created = applications.createApplication({
      orgName: 'acme',
      adminDisplayName: 'Acme Admin',
      hashedPassword: 'hash-of-password'
    });
    expect(created.status).toBe('pending');
    expect(applications.getApplication('acme')).toEqual({
      id: created.id,
      orgName: 'acme',
      adminDisplayName: 'Acme Admin',
      hashedPassword: 'hash-of-password',
      status: 'pending',
      createdAt: created.createdAt,
      updatedAt: created.updatedAt
    });

    expect(() =>
      applications.createApplication({
        orgName: 'acme',
        adminDisplayName: 'Duplicate',
        hashedPassword: 'hash-2'
      })
    ).toThrow();

    const approved = applications.updateApplicationStatus('acme', 'approved');
    expect(approved?.status).toBe('approved');
    expect(applications.listApplications('pending')).toEqual([]);
    expect(applications.listApplications('approved').map((application) => application.orgName)).toEqual(['acme']);
    expect(applications.listApplications()).toHaveLength(1);

    expect(applications.deleteApplication('acme')).toBe(true);
    expect(applications.getApplication('acme')).toBeUndefined();
    expect(applications.deleteApplication('acme')).toBe(false);
    db.close();
  });

  it('rejects an org application status outside the allowed domain', () => {
    const db = initDatabase(dbPath);
    const applications = new OrgApplicationRepository(db);
    applications.createApplication({
      orgName: 'acme',
      adminDisplayName: 'Acme Admin',
      hashedPassword: 'hash-of-password'
    });

    expect(() => applications.updateApplicationStatus('acme', 'bogus' as 'approved')).toThrow();
    expect(applications.getApplication('acme')?.status).toBe('pending');
    db.close();
  });
});
