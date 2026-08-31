import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { databaseSchema } from './schema.js';

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(databaseSchema);
  ensureColumn(db, 'created_by', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'owner', "TEXT NOT NULL DEFAULT 'platform'");
  ensureColumn(db, 'maintainers_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'skill_id', 'TEXT');
  ensureColumn(db, 'status', "TEXT NOT NULL DEFAULT 'published'");
  ensureColumn(db, 'notes', "TEXT NOT NULL DEFAULT ''", 'skill_releases');
  db.exec(`
    UPDATE skills
    SET created_by = author
    WHERE created_by = ''
  `);
  db.exec(`
    INSERT OR IGNORE INTO platform_settings (key, value)
    VALUES ('org_registration_mode', 'auto')
  `);
  return db;
}

function ensureColumn(db: Database.Database, column: string, definition: string, table = 'skills'): void {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export interface SkillRecord {
  name: string;
  skillId?: string;
  scope: string;
  skillName: string;
  description: string;
  createdBy: string;
  owner: string;
  maintainers: string[];
  visibility: string;
  status?: string;
  gitRepoPath: string;
}

export interface SkillReleaseRecord {
  skillId: string;
  skillName: string;
  version: string;
  sourceCommit: string;
  packagePath: string;
  checksum: string;
  releaseManifest: unknown;
  dependencyLock: unknown;
  notes?: string;
  createdBy: string;
}

export class SkillRepository {
  constructor(private readonly db: Database.Database) {}

  createSkill(skill: SkillRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO skills (
        name, scope, skill_name, description, author, created_by,
        owner, maintainers_json, visibility, git_repo_path
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      skill.name,
      skill.scope,
      skill.skillName,
      skill.description,
      skill.createdBy,
      skill.createdBy,
      skill.owner,
      JSON.stringify(skill.maintainers),
      skill.visibility,
      skill.gitRepoPath
    );
  }

  createServerSkill(skill: SkillRecord): SkillRecord {
    const skillId = skill.skillId ?? createSkillId();
    const status = skill.status ?? 'active-unreleased';
    const stmt = this.db.prepare(`
      INSERT INTO skills (
        name, skill_id, scope, skill_name, description, author, created_by,
        owner, maintainers_json, visibility, status, git_repo_path
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      skill.name,
      skillId,
      skill.scope,
      skill.skillName,
      skill.description,
      skill.createdBy,
      skill.createdBy,
      skill.owner,
      JSON.stringify(skill.maintainers),
      skill.visibility,
      status,
      skill.gitRepoPath
    );
    return this.getSkill(skill.name)!;
  }

  markPublished(name: string): void {
    this.db.prepare(`
      UPDATE skills
      SET status = 'active-published',
          skill_id = COALESCE(skill_id, ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE name = ?
    `).run(createSkillId(), name);
  }

  archiveSkill(name: string): void {
    this.db.prepare(`UPDATE skills SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE name = ?`).run(name);
  }

  restoreSkill(name: string): void {
    this.db.prepare(`UPDATE skills SET status = 'active-unreleased', updated_at = CURRENT_TIMESTAMP WHERE name = ?`).run(name);
  }

  deleteSkill(name: string): { skillId?: string; releases: number } {
    const skill = this.getSkill(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);
    const skillId = skill.skillId;
    const count = this.db.prepare(`
      SELECT COUNT(*) AS n
      FROM skill_releases
      WHERE skill_name = ? OR skill_id = ?
    `).get(name, skillId ?? '') as { n: number };
    const transaction = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM skill_releases WHERE skill_name = ? OR skill_id = ?`).run(name, skillId ?? '');
      this.db.prepare(`DELETE FROM skill_versions WHERE skill_name = ?`).run(name);
      this.db.prepare(`DELETE FROM skill_tags WHERE skill_name = ?`).run(name);
      this.db.prepare(`
        DELETE FROM skill_identity_redirects
        WHERE skill_id = ? OR current_name = ? OR old_name = ?
      `).run(skillId ?? '', name, name);
      this.db.prepare(`DELETE FROM skills WHERE name = ?`).run(name);
    });
    transaction();
    return { skillId, releases: count.n };
  }

  renameSkill(currentName: string, nextName: string, nextSkillName: string, nextGitRepoPath?: string): SkillRecord {
    const skill = this.getSkill(currentName);
    if (!skill?.skillId) throw new Error('Skill cannot be renamed without a Skill ID');
    if (this.getSkill(nextName)) throw new Error('Skill name already exists');
    const transaction = this.db.transaction(() => {
      this.db.pragma('defer_foreign_keys = ON');
      this.db.prepare(`UPDATE skill_versions SET skill_name = ? WHERE skill_name = ?`).run(nextName, currentName);
      this.db.prepare(`UPDATE skill_releases SET skill_name = ? WHERE skill_name = ?`).run(nextName, currentName);
      this.db.prepare(`
        UPDATE skills
        SET name = ?, scope = ?, skill_name = ?, git_repo_path = COALESCE(?, git_repo_path), updated_at = CURRENT_TIMESTAMP
        WHERE name = ?
      `).run(nextName, skill.scope, nextSkillName, nextGitRepoPath ?? null, currentName);
      this.db.prepare(`
        INSERT INTO skill_identity_redirects (old_name, skill_id, current_name)
        VALUES (?, ?, ?)
      `).run(currentName, skill.skillId, nextName);
    });
    transaction();
    return this.getSkill(nextName)!;
  }

  resolveRedirect(name: string): { skillId: string; currentName: string } | undefined {
    return this.db.prepare(`
      SELECT skill_id AS skillId, current_name AS currentName
      FROM skill_identity_redirects
      WHERE old_name = ?
    `).get(name) as { skillId: string; currentName: string } | undefined;
  }

  getSkill(name: string): SkillRecord | undefined {
    const stmt = this.db.prepare(`
      SELECT
        name,
        skill_id AS skillId,
        scope,
        skill_name AS skillName,
        description,
        created_by AS createdBy,
        owner,
        maintainers_json AS maintainersJson,
        visibility,
        status,
        git_repo_path AS gitRepoPath
      FROM skills
      WHERE name = ?
    `);
    const row = stmt.get(name) as (Omit<SkillRecord, 'maintainers'> & { maintainersJson: string }) | undefined;
    return row ? deserializeSkill(row) : undefined;
  }

  getSkillById(skillId: string): SkillRecord | undefined {
    const stmt = this.db.prepare(`
      SELECT
        name,
        skill_id AS skillId,
        scope,
        skill_name AS skillName,
        description,
        created_by AS createdBy,
        owner,
        maintainers_json AS maintainersJson,
        visibility,
        status,
        git_repo_path AS gitRepoPath
      FROM skills
      WHERE skill_id = ?
    `);
    const row = stmt.get(skillId) as (Omit<SkillRecord, 'maintainers'> & { maintainersJson: string }) | undefined;
    return row ? deserializeSkill(row) : undefined;
  }

  addVersion(skillName: string, version: string, readme?: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO skill_versions (skill_name, version, readme)
      VALUES (?, ?, ?)
    `);
    stmt.run(skillName, version, readme ?? null);
  }

  getVersions(skillName: string): string[] {
    const stmt = this.db.prepare(`
      SELECT version
      FROM skill_versions
      WHERE skill_name = ?
      ORDER BY id DESC
    `);
    return (stmt.all(skillName) as { version: string }[]).map((row) => row.version);
  }

  countSkillsByScope(scope: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM skills
      WHERE scope = ?
        AND status != 'archived'
    `);
    const row = stmt.get(scope) as { count: number };
    return row.count;
  }

  searchSkills(query: string): SkillRecord[] {
    const stmt = this.db.prepare(`
      SELECT
        name,
        scope,
        skill_name AS skillName,
        description,
        created_by AS createdBy,
        owner,
        maintainers_json AS maintainersJson,
        visibility,
        git_repo_path AS gitRepoPath
      FROM skills
      WHERE (name LIKE ? OR description LIKE ?)
        AND (status IS NULL OR status = 'published' OR status = 'active-published')
    `);
    const term = `%${query}%`;
    return (stmt.all(term, term) as (Omit<SkillRecord, 'maintainers'> & { maintainersJson: string })[])
      .map(deserializeSkill);
  }

  createRelease(release: SkillReleaseRecord): SkillReleaseRecord {
    this.db.prepare(`
      INSERT INTO skill_releases (
        skill_id, skill_name, version, source_commit, package_path, checksum,
        release_manifest_json, dependency_lock_json, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      release.skillId,
      release.skillName,
      release.version,
      release.sourceCommit,
      release.packagePath,
      release.checksum,
      JSON.stringify(release.releaseManifest),
      JSON.stringify(release.dependencyLock),
      release.notes ?? '',
      release.createdBy
    );
    return this.getRelease(release.skillName, release.version)!;
  }

  updateReleaseNotes(skillName: string, version: string, notes: string): SkillReleaseRecord | undefined {
    const result = this.db.prepare(`
      UPDATE skill_releases
      SET notes = ?
      WHERE skill_name = ? AND version = ?
    `).run(notes, skillName, version);
    if (result.changes === 0) {
      return undefined;
    }
    return this.getRelease(skillName, version);
  }

  getRelease(skillName: string, version: string): SkillReleaseRecord | undefined {
    const row = this.db.prepare(`
      SELECT
        skill_id AS skillId,
        skill_name AS skillName,
        version,
        source_commit AS sourceCommit,
        package_path AS packagePath,
        checksum,
        release_manifest_json AS releaseManifestJson,
        dependency_lock_json AS dependencyLockJson,
        notes,
        created_by AS createdBy
      FROM skill_releases
      WHERE skill_name = ? AND version = ?
    `).get(skillName, version) as ({
      releaseManifestJson: string;
      dependencyLockJson: string;
    } & Omit<SkillReleaseRecord, 'releaseManifest' | 'dependencyLock'>) | undefined;
    if (!row) return undefined;
    return {
      ...row,
      releaseManifest: JSON.parse(row.releaseManifestJson),
      dependencyLock: JSON.parse(row.dependencyLockJson)
    };
  }

  getReleases(skillName: string): SkillReleaseRecord[] {
    const rows = this.db.prepare(`
      SELECT
        skill_id AS skillId,
        skill_name AS skillName,
        version,
        source_commit AS sourceCommit,
        package_path AS packagePath,
        checksum,
        release_manifest_json AS releaseManifestJson,
        dependency_lock_json AS dependencyLockJson,
        notes,
        created_by AS createdBy
      FROM skill_releases
      WHERE skill_name = ?
      ORDER BY id DESC
    `).all(skillName) as ({
      releaseManifestJson: string;
      dependencyLockJson: string;
    } & Omit<SkillReleaseRecord, 'releaseManifest' | 'dependencyLock'>)[];
    return rows.map((row) => ({
      ...row,
      releaseManifest: JSON.parse(row.releaseManifestJson),
      dependencyLock: JSON.parse(row.dependencyLockJson)
    }));
  }
}

export interface AdminUserRecord {
  username: string;
  disabled: boolean;
  platformAdmin: boolean;
}

export class AdminRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly bootstrapAdminToken: string
  ) {
    this.ensureBootstrapAdmin();
  }

  getBootstrapStatus(status: {
    gitea: 'ready' | 'missing';
    adminToken: 'ready' | 'missing' | 'invalid';
    repoOwner: 'ready' | 'missing';
  }): {
    ready: boolean;
    gitea: 'ready' | 'missing';
    adminToken: 'ready' | 'missing' | 'invalid';
    repoOwner: 'ready' | 'missing';
  } {
    return {
      ready: status.gitea === 'ready' && status.adminToken === 'ready' && status.repoOwner === 'ready',
      gitea: status.gitea,
      adminToken: status.adminToken,
      repoOwner: status.repoOwner
    };
  }

  createUser(username: string): AdminUserRecord {
    const stmt = this.db.prepare(`
      INSERT INTO admin_users (username, disabled, platform_admin)
      VALUES (?, 0, 0)
      ON CONFLICT(username) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(username);
    return this.getUser(username)!;
  }

  registerIssuedToken(username: string, token: string): void {
    let user = this.getUser(username);
    if (!user) {
      this.createUser(username);
      user = this.getUser(username)!;
    }
    if (user.disabled) {
      throw new Error(`User is disabled: ${username}`);
    }
    const stmt = this.db.prepare(`
      INSERT INTO admin_tokens (token_hash, username, revoked)
      VALUES (?, ?, 0)
    `);
    stmt.run(hashToken(token), username);
  }

  disableUser(username: string): AdminUserRecord {
    const stmt = this.db.prepare(`
      UPDATE admin_users
      SET disabled = 1, updated_at = CURRENT_TIMESTAMP
      WHERE username = ?
    `);
    stmt.run(username);
    const revoke = this.db.prepare(`
      UPDATE admin_tokens
      SET revoked = 1
      WHERE username = ?
    `);
    revoke.run(username);
    const user = this.getUser(username);
    if (!user) {
      throw new Error(`User not found: ${username}`);
    }
    return user;
  }

  getPlatformAdminForToken(token: string): { username: string } | null {
    if (token === this.bootstrapAdminToken) {
      return { username: 'admin' };
    }
    const stmt = this.db.prepare(`
      SELECT u.username AS username, u.disabled AS disabled, u.platform_admin AS platformAdmin, t.revoked AS revoked
      FROM admin_tokens t
      JOIN admin_users u ON u.username = t.username
      WHERE t.token_hash = ?
    `);
    const row = stmt.get(hashToken(token)) as { username: string; disabled: number; platformAdmin: number; revoked: number } | undefined;
    if (!row || row.platformAdmin !== 1 || row.disabled === 1 || row.revoked === 1) {
      return null;
    }
    return { username: row.username };
  }

  validateUserToken(token: string): { username: string } | null {
    const stmt = this.db.prepare(`
      SELECT u.username AS username, u.disabled AS disabled, t.revoked AS revoked
      FROM admin_tokens t
      JOIN admin_users u ON u.username = t.username
      WHERE t.token_hash = ?
    `);
    const row = stmt.get(hashToken(token)) as { username: string; disabled: number; revoked: number } | undefined;
    if (!row || row.disabled === 1 || row.revoked === 1) {
      return null;
    }
    return { username: row.username };
  }

  hasIssuedToken(token: string): boolean {
    const stmt = this.db.prepare(`
      SELECT token_hash AS tokenHash
      FROM admin_tokens
      WHERE token_hash = ?
    `);
    return Boolean(stmt.get(hashToken(token)));
  }

  private ensureBootstrapAdmin(): void {
    const stmt = this.db.prepare(`
      INSERT INTO admin_users (username, disabled, platform_admin)
      VALUES ('admin', 0, 1)
      ON CONFLICT(username) DO NOTHING
    `);
    stmt.run();
  }

  private getUser(username: string): AdminUserRecord | undefined {
    const stmt = this.db.prepare(`
      SELECT username, disabled, platform_admin AS platformAdmin
      FROM admin_users
      WHERE username = ?
    `);
    const row = stmt.get(username) as { username: string; disabled: number; platformAdmin: number } | undefined;
    return row
      ? { username: row.username, disabled: row.disabled === 1, platformAdmin: row.platformAdmin === 1 }
      : undefined;
  }
}

export type OrgApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface OrgApplicationRecord {
  id: number;
  orgName: string;
  adminDisplayName: string;
  hashedPassword: string;
  status: OrgApplicationStatus;
  createdAt: string;
  updatedAt: string;
}

export class OrgApplicationRepository {
  constructor(private readonly db: Database.Database) {}

  createApplication(input: {
    orgName: string;
    adminDisplayName: string;
    hashedPassword: string;
  }): OrgApplicationRecord {
    const stmt = this.db.prepare(`
      INSERT INTO org_applications (org_name, admin_display_name, hashed_password, status)
      VALUES (?, ?, ?, 'pending')
    `);
    stmt.run(input.orgName, input.adminDisplayName, input.hashedPassword);
    return this.getApplication(input.orgName)!;
  }

  getApplication(orgName: string): OrgApplicationRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, org_name, admin_display_name, hashed_password, status, created_at, updated_at
      FROM org_applications
      WHERE org_name = ?
    `).get(orgName) as {
      id: number;
      org_name: string;
      admin_display_name: string;
      hashed_password: string;
      status: OrgApplicationStatus;
      created_at: string;
      updated_at: string;
    } | undefined;
    return row ? this.deserialize(row) : undefined;
  }

  listApplications(status?: OrgApplicationStatus): OrgApplicationRecord[] {
    const rows = (
      status
        ? this.db.prepare(`
            SELECT id, org_name, admin_display_name, hashed_password, status, created_at, updated_at
            FROM org_applications
            WHERE status = ?
            ORDER BY id ASC
          `).all(status)
        : this.db.prepare(`
            SELECT id, org_name, admin_display_name, hashed_password, status, created_at, updated_at
            FROM org_applications
            ORDER BY id ASC
          `).all()
    ) as Parameters<OrgApplicationRepository['deserialize']>[0][];
    return rows.map((row) => this.deserialize(row));
  }

  updateApplicationStatus(orgName: string, status: OrgApplicationStatus): OrgApplicationRecord | undefined {
    const stmt = this.db.prepare(`
      UPDATE org_applications
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE org_name = ?
    `);
    stmt.run(status, orgName);
    return this.getApplication(orgName);
  }

  getApplicationById(id: number): OrgApplicationRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, org_name, admin_display_name, hashed_password, status, created_at, updated_at
      FROM org_applications
      WHERE id = ?
    `).get(id) as Parameters<OrgApplicationRepository['deserialize']>[0] | undefined;
    return row ? this.deserialize(row) : undefined;
  }

  updateApplicationStatusById(id: number, status: OrgApplicationStatus): OrgApplicationRecord | undefined {
    const stmt = this.db.prepare(`
      UPDATE org_applications
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(status, id);
    return this.getApplicationById(id);
  }

  deleteApplication(orgName: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM org_applications
      WHERE org_name = ?
    `);
    return stmt.run(orgName).changes > 0;
  }

  private deserialize(row: {
    id: number;
    org_name: string;
    admin_display_name: string;
    hashed_password: string;
    status: OrgApplicationStatus;
    created_at: string;
    updated_at: string;
  }): OrgApplicationRecord {
    return {
      id: row.id,
      orgName: row.org_name,
      adminDisplayName: row.admin_display_name,
      hashedPassword: row.hashed_password,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export class PlatformSettingsRepository {
  constructor(private readonly db: Database.Database) {}

  getSetting(key: string): string | undefined {
    const row = this.db.prepare(`
      SELECT value
      FROM platform_settings
      WHERE key = ?
    `).get(key) as { value: string } | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO platform_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, value);
  }
}

function hashToken(token: string): string {
  return hashSecret(token);
}

function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function deserializeSkill(
  row: Omit<SkillRecord, 'maintainers'> & { maintainersJson: string }
): SkillRecord {
  const skill: SkillRecord = {
    name: row.name,
    scope: row.scope,
    skillName: row.skillName,
    description: row.description,
    createdBy: row.createdBy,
    owner: row.owner,
    maintainers: JSON.parse(row.maintainersJson) as string[],
    visibility: row.visibility,
    gitRepoPath: row.gitRepoPath
  };
  if (row.skillId) skill.skillId = row.skillId;
  if (row.skillId && row.status) skill.status = row.status;
  return skill;
}

function createSkillId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = crypto.randomBytes(26);
  return `sk_${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')}`;
}
