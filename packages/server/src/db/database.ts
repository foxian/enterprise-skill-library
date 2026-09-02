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

  // 删除整个组织的全部技能及其关联数据（组织删除时调用）。
  deleteSkillsByScope(scope: string): number {
    const names = (
      this.db.prepare(`SELECT name FROM skills WHERE scope = ?`).all(scope) as { name: string }[]
    ).map((row) => row.name);
    const transaction = this.db.transaction(() => {
      for (const name of names) {
        const skillId = (this.db.prepare(`SELECT skill_id AS skillId FROM skills WHERE name = ?`).get(name) as
          | { skillId?: string }
          | undefined)?.skillId;
        this.db.prepare(`DELETE FROM skill_releases WHERE skill_name = ? OR skill_id = ?`).run(name, skillId ?? '');
        this.db.prepare(`DELETE FROM skill_versions WHERE skill_name = ?`).run(name);
        this.db.prepare(`DELETE FROM skill_tags WHERE skill_name = ?`).run(name);
        this.db.prepare(`
          DELETE FROM skill_identity_redirects
          WHERE skill_id = ? OR current_name = ? OR old_name = ?
        `).run(skillId ?? '', name, name);
        this.db.prepare(`DELETE FROM skills WHERE name = ?`).run(name);
      }
    });
    transaction();
    return names.length;
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

export type OperationStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'permanently_failed';

export interface OperationError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface OperationRecord {
  id: number;
  idempotencyKey: string;
  kind: string;
  status: OperationStatus;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  leaseOwner: string | null;
  leaseUntil: string | null;
  error: OperationError | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOperationInput {
  idempotencyKey: string;
  kind: string;
  payload: unknown;
  maxAttempts?: number;
}

export interface OperationRepositoryOptions {
  now?: () => Date;
  leaseDurationMs?: number;
  retryBaseDelayMs?: number;
}

interface OperationRow {
  id: number;
  idempotency_key: string;
  kind: string;
  status: OperationStatus;
  payload_json: string;
  attempts: number;
  max_attempts: number;
  next_retry_at: string | null;
  lease_owner: string | null;
  lease_until: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
}

export class OperationRepository {
  private readonly now: () => Date;
  private readonly leaseDurationMs: number;
  private readonly retryBaseDelayMs: number;

  constructor(
    private readonly db: Database.Database,
    options: OperationRepositoryOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.leaseDurationMs = options.leaseDurationMs ?? 60_000;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
  }

  createOperation(input: CreateOperationInput): OperationRecord {
    const maxAttempts = input.maxAttempts ?? 5;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error('maxAttempts must be a positive integer');
    }
    const payloadJson = JSON.stringify(input.payload) ?? 'null';
    const transaction = this.db.transaction(() => {
      const existing = this.getOperationByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        if (existing.kind !== input.kind || JSON.stringify(existing.payload) !== payloadJson) {
          throw new Error('Idempotency key already belongs to another operation');
        }
        return existing;
      }

      const now = this.nowIso();
      const result = this.db.prepare(`
        INSERT INTO operations (
          idempotency_key, kind, payload_json, max_attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(input.idempotencyKey, input.kind, payloadJson, maxAttempts, now, now);
      return this.getOperation(Number(result.lastInsertRowid))!;
    });
    return transaction() as OperationRecord;
  }

  getOperation(id: number): OperationRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, idempotency_key, kind, status, payload_json, attempts, max_attempts,
             next_retry_at, lease_owner, lease_until, error_json, created_at, updated_at
      FROM operations
      WHERE id = ?
    `).get(id) as OperationRow | undefined;
    return row ? deserializeOperation(row) : undefined;
  }

  getOperationByIdempotencyKey(idempotencyKey: string): OperationRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, idempotency_key, kind, status, payload_json, attempts, max_attempts,
             next_retry_at, lease_owner, lease_until, error_json, created_at, updated_at
      FROM operations
      WHERE idempotency_key = ?
    `).get(idempotencyKey) as OperationRow | undefined;
    return row ? deserializeOperation(row) : undefined;
  }

  claimOperation(id: number, leaseOwner: string): OperationRecord | undefined {
    const transaction = this.db.transaction(() => this.claimOperationInTransaction(id, leaseOwner));
    return transaction() as OperationRecord | undefined;
  }

  claimNextOperation(leaseOwner: string): OperationRecord | undefined {
    const now = this.nowIso();
    const transaction = this.db.transaction(() => {
      this.expireExhaustedLease(now);
      const row = this.db.prepare(`
        SELECT id
        FROM operations
        WHERE attempts < max_attempts
          AND (
            (status IN ('pending', 'failed') AND (next_retry_at IS NULL OR next_retry_at <= ?))
            OR (status = 'running' AND lease_until <= ?)
          )
        ORDER BY id ASC
        LIMIT 1
      `).get(now, now) as { id: number } | undefined;
      return row ? this.claimOperationInTransaction(row.id, leaseOwner) : undefined;
    });
    return transaction() as OperationRecord | undefined;
  }

  completeOperation(id: number, leaseOwner: string): OperationRecord | undefined {
    const transaction = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE operations
        SET status = 'succeeded', next_retry_at = NULL, lease_owner = NULL,
            lease_until = NULL, error_json = NULL, updated_at = ?
        WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_until > ?
      `).run(this.nowIso(), id, leaseOwner, this.nowIso());
      return result.changes > 0 ? this.getOperation(id) : undefined;
    });
    return transaction() as OperationRecord | undefined;
  }

  failOperation(id: number, leaseOwner: string, error: unknown): OperationRecord | undefined {
    const safeError = sanitizeOperationError(error);
    const transaction = this.db.transaction(() => {
      const current = this.db.prepare(`
        SELECT attempts, max_attempts
        FROM operations
        WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_until > ?
      `).get(id, leaseOwner, this.nowIso()) as { attempts: number; max_attempts: number } | undefined;
      if (!current) return undefined;

      const now = this.now();
      const permanentlyFailed = current.attempts >= current.max_attempts;
      const nextRetryAt = permanentlyFailed
        ? null
        : new Date(now.getTime() + this.retryBaseDelayMs * 2 ** (current.attempts - 1)).toISOString();
      this.db.prepare(`
        UPDATE operations
        SET status = ?, next_retry_at = ?, lease_owner = NULL, lease_until = NULL,
            error_json = ?, updated_at = ?
        WHERE id = ? AND status = 'running' AND lease_owner = ?
      `).run(
        permanentlyFailed ? 'permanently_failed' : 'failed',
        nextRetryAt,
        JSON.stringify(safeError),
        now.toISOString(),
        id,
        leaseOwner
      );
      return this.getOperation(id);
    });
    return transaction() as OperationRecord | undefined;
  }

  retryOperation(id: number): OperationRecord | undefined {
    const transaction = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE operations
        SET status = 'pending', attempts = 0, next_retry_at = NULL,
            lease_owner = NULL, lease_until = NULL, error_json = NULL,
            updated_at = ?
        WHERE id = ? AND status IN ('failed', 'permanently_failed')
      `).run(this.nowIso(), id);
      return result.changes > 0 ? this.getOperation(id) : undefined;
    });
    return transaction() as OperationRecord | undefined;
  }

  renewLease(id: number, leaseOwner: string): OperationRecord | undefined {
    const transaction = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE operations
        SET lease_until = ?, updated_at = ?
        WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_until > ?
      `).run(this.leaseUntilIso(), this.nowIso(), id, leaseOwner, this.nowIso());
      return result.changes > 0 ? this.getOperation(id) : undefined;
    });
    return transaction() as OperationRecord | undefined;
  }

  private claimOperationInTransaction(id: number, leaseOwner: string): OperationRecord | undefined {
    const now = this.nowIso();
    this.expireExhaustedLease(now, id);
    const result = this.db.prepare(`
      UPDATE operations
      SET status = 'running', attempts = attempts + 1, next_retry_at = NULL,
          lease_owner = ?, lease_until = ?, error_json = NULL, updated_at = ?
      WHERE id = ?
        AND attempts < max_attempts
        AND (
          (status IN ('pending', 'failed') AND (next_retry_at IS NULL OR next_retry_at <= ?))
          OR (status = 'running' AND lease_until <= ?)
        )
    `).run(leaseOwner, this.leaseUntilIso(), now, id, now, now);
    return result.changes > 0 ? this.getOperation(id) : undefined;
  }

  private expireExhaustedLease(now: string, id?: number): void {
    this.db.prepare(`
      UPDATE operations
      SET status = 'permanently_failed', next_retry_at = NULL,
          lease_owner = NULL, lease_until = NULL,
          error_json = ?, updated_at = ?
      WHERE status = 'running'
        AND attempts >= max_attempts
        AND lease_until <= ?
        AND (? IS NULL OR id = ?)
    `).run(
      JSON.stringify({
        code: 'LEASE_EXPIRED',
        message: 'Operation lease expired after the final attempt',
        details: {}
      }),
      now,
      now,
      id ?? null,
      id ?? null
    );
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private leaseUntilIso(): string {
    return new Date(this.now().getTime() + this.leaseDurationMs).toISOString();
  }
}

export interface OperationAuditRecord {
  id: number;
  operationId: number;
  event: string;
  actor: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export class OperationAuditRepository {
  constructor(private readonly db: Database.Database) {}

  record(input: {
    operationId: number;
    event: string;
    actor?: string;
    details?: unknown;
  }): OperationAuditRecord {
    const details = sanitizeDetails(input.details);
    const transaction = this.db.transaction(() => {
      const now = new Date().toISOString();
      const result = this.db.prepare(`
        INSERT INTO operation_audits (operation_id, event, actor, details_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(input.operationId, input.event, input.actor ?? null, JSON.stringify(details), now);
      return this.getById(Number(result.lastInsertRowid))!;
    });
    return transaction() as OperationAuditRecord;
  }

  getById(id: number): OperationAuditRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, operation_id, event, actor, details_json, created_at
      FROM operation_audits
      WHERE id = ?
    `).get(id) as {
      id: number;
      operation_id: number;
      event: string;
      actor: string | null;
      details_json: string;
      created_at: string;
    } | undefined;
    return row ? deserializeOperationAudit(row) : undefined;
  }

  listByOperation(operationId: number): OperationAuditRecord[] {
    const rows = this.db.prepare(`
      SELECT id, operation_id, event, actor, details_json, created_at
      FROM operation_audits
      WHERE operation_id = ?
      ORDER BY id ASC
    `).all(operationId) as {
      id: number;
      operation_id: number;
      event: string;
      actor: string | null;
      details_json: string;
      created_at: string;
    }[];
    return rows.map(deserializeOperationAudit);
  }
}

export type TenantOrganizationStatus =
  | 'pending'
  | 'provisioning'
  | 'active'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'deleting'
  | 'delete_failed';

export interface TenantOrganizationRecord {
  orgName: string;
  status: TenantOrganizationStatus;
  operationId: number | null;
  lastError: OperationError | null;
  createdAt: string;
  updatedAt: string;
}

export class TenantOrganizationRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    orgName: string;
    status?: TenantOrganizationStatus;
    operationId?: number;
  }): TenantOrganizationRecord {
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO tenant_organizations (org_name, status, operation_id)
        VALUES (?, ?, ?)
      `).run(input.orgName, input.status ?? 'provisioning', input.operationId ?? null);
      return this.get(input.orgName)!;
    });
    return transaction() as TenantOrganizationRecord;
  }

  get(orgName: string): TenantOrganizationRecord | undefined {
    const row = this.db.prepare(`
      SELECT org_name, status, operation_id, last_error_json, created_at, updated_at
      FROM tenant_organizations
      WHERE org_name = ?
    `).get(orgName) as {
      org_name: string;
      status: TenantOrganizationStatus;
      operation_id: number | null;
      last_error_json: string | null;
      created_at: string;
      updated_at: string;
    } | undefined;
    if (!row) return undefined;
    return {
      orgName: row.org_name,
      status: row.status,
      operationId: row.operation_id,
      lastError: row.last_error_json ? (JSON.parse(row.last_error_json) as OperationError) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  transition(
    orgName: string,
    status: TenantOrganizationStatus,
    error?: OperationError
  ): TenantOrganizationRecord | undefined {
    const transaction = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE tenant_organizations
        SET status = ?, last_error_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE org_name = ?
      `).run(status, error ? JSON.stringify(error) : null, orgName);
      return result.changes > 0 ? this.get(orgName) : undefined;
    });
    return transaction() as TenantOrganizationRecord | undefined;
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

function deserializeOperation(row: OperationRow): OperationRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind,
    status: row.status,
    payload: JSON.parse(row.payload_json) as unknown,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextRetryAt: row.next_retry_at,
    leaseOwner: row.lease_owner,
    leaseUntil: row.lease_until,
    error: row.error_json ? (JSON.parse(row.error_json) as OperationError) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function deserializeOperationAudit(row: {
  id: number;
  operation_id: number;
  event: string;
  actor: string | null;
  details_json: string;
  created_at: string;
}): OperationAuditRecord {
  return {
    id: row.id,
    operationId: row.operation_id,
    event: row.event,
    actor: row.actor,
    details: JSON.parse(row.details_json) as Record<string, unknown>,
    createdAt: row.created_at
  };
}

function sanitizeOperationError(error: unknown): OperationError {
  const source = error instanceof Error
    ? { code: 'OPERATION_FAILED', message: error.message }
    : isRecord(error)
      ? error
      : { message: String(error) };
  const code = typeof source.code === 'string' && /^[A-Z0-9_.:-]+$/.test(source.code)
    ? source.code
    : 'OPERATION_FAILED';
  const message = typeof source.message === 'string' ? sanitizeText(source.message) : 'Operation failed';
  return {
    code,
    message: message || 'Operation failed',
    details: sanitizeDetails(source.details)
  };
}

function sanitizeDetails(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    sanitized[key] = sanitizeDetailValue(entry);
  }
  return sanitized;
}

function sanitizeDetailValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeDetailValue);
  if (isRecord(value)) return sanitizeDetails(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  return undefined;
}

function sanitizeText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*)Bearer\s+[^\s,;]+/gi, '$1Bearer [REDACTED]')
    .replace(/((?:password|token|secret|credential|api[_ -]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function isSensitiveKey(key: string): boolean {
  return /password|token|secret|authorization|credential|api[_ -]?key|cookie|stack/i.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createSkillId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = crypto.randomBytes(26);
  return `sk_${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')}`;
}
