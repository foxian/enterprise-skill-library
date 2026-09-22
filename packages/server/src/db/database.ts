import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { databaseSchema } from './schema.js';
import { logEvent, type DiagnosticLogger } from '../logging.js';

// 慢操作阈值（ADR-0045）：本期用代码内常量，不引入额外的配置面。
export const SQLITE_SLOW_OP_MS = 250;

// better-sqlite3 抛出的错误带稳定 code（SQLITE_BUSY / SQLITE_LOCKED /
// SQLITE_CORRUPT / SQLITE_NOTADB…）。这里映射成机器可读的基础设施错误标识，
// 让锁冲突与数据文件损坏在日志里可检索——不记录 SQL 文本或绑定参数（US35）。
export function classifySqliteError(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') {
    return 'sqliteError';
  }
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
    return 'sqliteLocked';
  }
  if (code.startsWith('SQLITE_CORRUPT')) {
    return 'sqliteCorrupt';
  }
  if (code === 'SQLITE_NOTADB') {
    return 'sqliteNotADatabase';
  }
  return 'sqliteError';
}

function slowFields(startedAt: number): { durationMs: number; slow?: boolean } {
  const durationMs = Date.now() - startedAt;
  return durationMs > SQLITE_SLOW_OP_MS ? { durationMs, slow: true } : { durationMs };
}

// 数据访问层只记录打开、schema、锁与损坏这类异常或慢操作；SQL 文本与参数一律
// 不进日志，避免把业务数据带进日志（ADR-0045）。logger 可选，未提供时静默。
export function initDatabase(dbPath: string, logger?: DiagnosticLogger): Database.Database {
  const openStartedAt = Date.now();
  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch (error) {
    logEvent(
      logger,
      'error',
      {
        event: 'sqlite.open',
        outcome: 'failed',
        errorCode: classifySqliteError(error),
        err: error
      },
      'SQLite database open failed'
    );
    throw error;
  }
  logEvent(
    logger,
    'debug',
    { event: 'sqlite.open', outcome: 'succeeded', ...slowFields(openStartedAt) },
    'SQLite database opened'
  );

  const schemaStartedAt = Date.now();
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(databaseSchema);
    ensureColumn(db, 'created_by', "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, 'owner', "TEXT NOT NULL DEFAULT 'platform'");
    ensureColumn(db, 'maintainers_json', "TEXT NOT NULL DEFAULT '[]'");
    ensureColumn(db, 'skill_id', 'TEXT');
    ensureColumn(db, 'status', "TEXT NOT NULL DEFAULT 'published'");
    ensureColumn(db, 'display_name', 'TEXT');
    ensureColumn(db, 'deletion_requested_by', 'TEXT');
    ensureColumn(db, 'deletion_reason', 'TEXT');
    ensureColumn(db, 'deletion_error', 'TEXT');
    ensureColumn(db, 'deletion_requested_at', 'DATETIME');
    ensureColumn(db, 'notes', "TEXT NOT NULL DEFAULT ''", 'skill_releases');
    ensureColumn(db, 'deprecated_message', 'TEXT', 'skill_releases');
    ensureColumn(db, 'deleted_at', 'DATETIME', 'skill_releases');
    ensureColumn(db, 'deleted_by', 'TEXT', 'skill_releases');
    ensureColumn(db, "applicant_username", "TEXT NOT NULL DEFAULT ''", 'org_applications');
    ensureColumn(db, 'locale', 'TEXT', 'admin_users');
    ensureColumn(db, 'email', 'TEXT', 'user_registrations');
    db.exec(`
      UPDATE skills
      SET created_by = author
      WHERE created_by = ''
    `);
    db.exec(`
      INSERT OR IGNORE INTO platform_settings (key, value)
      VALUES
        ('org_registration_mode', 'auto'),
        ('registration_mode', 'open'),
        ('member_add_mode', 'direct'),
        ('admin_provisioned_password_change_policy', 'force')
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS user_registrations_pending_email_unique
      ON user_registrations (email)
      WHERE status = 'pending' AND email IS NOT NULL
    `);
  } catch (error) {
    logEvent(
      logger,
      'error',
      {
        event: 'sqlite.schema',
        outcome: 'failed',
        errorCode: classifySqliteError(error),
        err: error
      },
      'SQLite schema initialization failed'
    );
    // 半初始化的句柄不该继续持有文件锁：打开成功但 schema 失败时显式关闭。
    db.close();
    throw error;
  }
  logEvent(
    logger,
    'debug',
    { event: 'sqlite.schema', outcome: 'succeeded', ...slowFields(schemaStartedAt) },
    'SQLite schema initialized'
  );

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
  /** 当前源码显示名（ADR-0048）：从未发布时作为对外显示名来源；曾发布后由最近 Release 快照覆盖。 */
  displayName?: string;
  createdBy: string;
  owner: string;
  maintainers: string[];
  visibility: string;
  status?: string;
  gitRepoPath: string;
  deletionRequestedBy?: string | null;
  deletionReason?: string | null;
  deletionError?: string | null;
  deletionRequestedAt?: string | null;
}

export interface SkillDeletionAuditInput {
  fullName: string;
  deletedBy: string;
  reason: string;
  dependents?: string[];
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
  /** Set when the release is deprecated: the message shown to anyone installing it. */
  deprecatedMessage?: string | null;
  /** Set on a tombstone left behind by deleting a release; the version stays burned. */
  deletedAt?: string | null;
  deletedBy?: string | null;
  createdBy: string;
  createdAt?: string;
}

export class SkillRepository {
  constructor(private readonly db: Database.Database) {}

  createSkill(skill: SkillRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO skills (
        name, scope, skill_name, description, display_name, author, created_by,
        owner, maintainers_json, visibility, git_repo_path
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      skill.name,
      skill.scope,
      skill.skillName,
      skill.description,
      skill.displayName ?? null,
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
        name, skill_id, scope, skill_name, description, display_name, author, created_by,
        owner, maintainers_json, visibility, status, git_repo_path
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      skill.name,
      skillId,
      skill.scope,
      skill.skillName,
      skill.description,
      skill.displayName ?? null,
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

  // Restore 是 Archive 的逆向动作：曾发布技能必须回到可安装的 active-published，
  // 从未发布技能回到 active-unreleased；不能用“当前是否还有 release”判断，
  // 因为已删除 Release 的 tombstone 也代表这个版本号曾经被占用。
  restoreSkill(name: string, everPublished = false): void {
    const status = everPublished ? 'active-published' : 'active-unreleased';
    this.db.prepare(`
      UPDATE skills
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE name = ?
    `).run(status, name);
  }

  /** 判断“曾发布”的唯一来源：skill_releases 包括单版本删除留下的 tombstone。 */
  hasEverPublished(skillName: string): boolean {
    const row = this.db.prepare(`
      SELECT EXISTS (
        SELECT 1 FROM skill_releases
        WHERE skill_name = ? OR skill_id = (SELECT skill_id FROM skills WHERE name = ?)
      ) AS present
    `).get(skillName, skillName) as { present: number };
    return row.present === 1;
  }

  /** 汇总所有仍活跃 Release 的依赖锁中引用该 Skill ID 的技能名，不阻断删除。 */
  findSkillDependents(skillId: string): string[] {
    const rows = this.db
      .prepare(`
        SELECT skill_name AS skillName, dependency_lock_json AS dependencyLockJson
        FROM skill_releases
        WHERE deleted_at IS NULL
      `)
      .all() as { skillName: string; dependencyLockJson: string }[];
    const dependents = new Set<string>();
    for (const row of rows) {
      let lock: Record<string, { skillId?: string; version?: string }>;
      try {
        lock = JSON.parse(row.dependencyLockJson) as Record<string, { skillId?: string; version?: string }>;
      } catch {
        continue;
      }
      if (Object.values(lock).some((entry) => entry?.skillId === skillId)) dependents.add(row.skillName);
    }
    return [...dependents].sort();
  }

  /** 进入 Deleting Workflow；只允许从可重试的两个删除前置状态开始。 */
  beginSkillDeletion(input: { name: string; requestedBy: string; reason: string }): void {
    const result = this.db.prepare(`
      UPDATE skills
      SET status = 'deleting',
          deletion_requested_by = ?,
          deletion_reason = ?,
          deletion_error = NULL,
          deletion_requested_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE name = ? AND status IN ('archived', 'delete_failed')
    `).run(input.requestedBy, input.reason, input.name);
    if (result.changes === 0) {
      throw new Error('Skill must be archived before deletion');
    }
  }

  /** 外部资产清理失败时保留技能与请求者/原因，便于从 Web 重试。 */
  markSkillDeletionFailed(name: string, error: string): void {
    this.db.prepare(`
      UPDATE skills
      SET status = 'delete_failed',
          deletion_error = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE name = ?
    `).run(error, name);
  }

  getDeletionMetadata(name: string): {
    requestedBy?: string | null;
    reason?: string | null;
    error?: string | null;
    requestedAt?: string | null;
  } | undefined {
    const row = this.db.prepare(`
      SELECT
        deletion_requested_by AS requestedBy,
        deletion_reason AS reason,
        deletion_error AS error,
        deletion_requested_at AS requestedAt
      FROM skills
      WHERE name = ?
    `).get(name) as { requestedBy?: string | null; reason?: string | null; error?: string | null; requestedAt?: string | null } | undefined;
    return row;
  }

  // 技能描述(CONTEXT:Skill Description)由 Source Upload 登记,随后续 Source
  // Update 经专用端点更新;它不属于任何 Skill Release 的固化内容。
  // 逐技能可见性（ADR-0032）：public = 平台全员可搜可装；private（默认）= 仅被授权者。
  setVisibility(name: string, visibility: 'public' | 'private'): boolean {
    const result = this.db
      .prepare(`UPDATE skills SET visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?`)
      .run(visibility, name);
    return result.changes > 0;
  }

  updateSkillDescription(name: string, description: string): boolean {
    const result = this.db
      .prepare(`UPDATE skills SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?`)
      .run(description, name);
    return result.changes > 0;
  }

  updateSkillDisplayName(name: string, displayName: string | null): boolean {
    const result = this.db
      .prepare(`UPDATE skills SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?`)
      .run(displayName, name);
    return result.changes > 0;
  }

  /**
   * 最终删除与审计在同一事务：如果技能记录删除成功，审计必须已经写入；audit
   * 不设 skills 外键，因此审计生命周期独立于被删记录。
   */
  deleteSkillWithAudit(input: SkillDeletionAuditInput): { skillId?: string; releases: number } {
    const skill = this.getSkill(input.fullName);
    if (!skill) throw new Error(`Skill not found: ${input.fullName}`);
    const skillId = skill.skillId;
    const count = this.db.prepare(`
      SELECT COUNT(*) AS n
      FROM skill_releases
      WHERE skill_name = ? OR skill_id = ?
    `).get(skill.name, skillId ?? '') as { n: number };
    const dependents = input.dependents ?? this.findSkillDependents(skillId ?? '');
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO skill_deletion_audits (
          skill_id, full_name, scope, skill_name, deleted_by, reason,
          releases_removed, dependents_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        skillId ?? null,
        skill.name,
        skill.scope,
        skill.skillName,
        input.deletedBy,
        input.reason,
        count.n,
        JSON.stringify(dependents)
      );
      this.db.prepare(`DELETE FROM skill_releases WHERE skill_name = ? OR skill_id = ?`).run(skill.name, skillId ?? '');
      this.db.prepare(`DELETE FROM skill_versions WHERE skill_name = ?`).run(skill.name);
      this.db.prepare(`DELETE FROM skill_tags WHERE skill_name = ?`).run(skill.name);
      this.db.prepare(`
        DELETE FROM skill_identity_redirects
        WHERE skill_id = ? OR current_name = ? OR old_name = ?
      `).run(skillId ?? '', skill.name, skill.name);
      this.db.prepare(`DELETE FROM skills WHERE name = ?`).run(skill.name);
    });
    transaction();
    return { skillId, releases: count.n };
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
        display_name AS displayName,
        created_by AS createdBy,
        owner,
        maintainers_json AS maintainersJson,
        visibility,
        status,
        git_repo_path AS gitRepoPath,
        deletion_requested_by AS deletionRequestedBy,
        deletion_reason AS deletionReason,
        deletion_error AS deletionError,
        deletion_requested_at AS deletionRequestedAt
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
        display_name AS displayName,
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

  // Resource Provenance 查询:确认 Git Backend 仓库由 ESL 技能登记创建。
  getSkillByGitRepoPath(gitRepoPath: string): SkillRecord | undefined {
    const stmt = this.db.prepare(`
      SELECT
        name,
        skill_id AS skillId,
        scope,
        skill_name AS skillName,
        description,
        display_name AS displayName,
        created_by AS createdBy,
        owner,
        maintainers_json AS maintainersJson,
        visibility,
        status,
        git_repo_path AS gitRepoPath
      FROM skills
      WHERE git_repo_path = ?
    `);
    const row = stmt.get(gitRepoPath) as (Omit<SkillRecord, 'maintainers'> & { maintainersJson: string }) | undefined;
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

  // 全量技能清单(含未发布,ADR-0025):管理后台的角色化可见性视图以此为基础,
  // 再按调用方身份(超管/所有者成员/成员)与 Git Backend 权限过滤。
  listSkills(): SkillRecord[] {
    const stmt = this.db.prepare(`
      SELECT
        name,
        skill_id AS skillId,
        scope,
        skill_name AS skillName,
        description,
        display_name AS displayName,
        created_by AS createdBy,
        owner,
        maintainers_json AS maintainersJson,
        visibility,
        status,
        git_repo_path AS gitRepoPath
      FROM skills
      ORDER BY updated_at DESC, created_at DESC
    `);
    return (stmt.all() as (Omit<SkillRecord, 'maintainers'> & { maintainersJson: string })[]).map(deserializeSkill);
  }

  searchSkills(query: string): SkillRecord[] {
    const stmt = this.db.prepare(`
      SELECT
        name,
        scope,
        skill_name AS skillName,
        description,
        display_name AS displayName,
        created_by AS createdBy,
        owner,
        maintainers_json AS maintainersJson,
        visibility,
        git_repo_path AS gitRepoPath
      FROM skills
      WHERE (name LIKE ? OR description LIKE ? OR display_name LIKE ? OR EXISTS (
          SELECT 1
          FROM skill_releases r
          WHERE r.skill_name = skills.name
            AND r.deleted_at IS NULL
            AND r.id = (SELECT MAX(r2.id) FROM skill_releases r2
                        WHERE r2.skill_name = skills.name AND r2.deleted_at IS NULL)
            AND json_extract(r.release_manifest_json, '$.displayName') LIKE ?
        ))
        AND (status IS NULL OR status = 'published' OR status = 'active-published')
    `);
    const term = `%${query}%`;
    // 对外显示名对已发布技能来自最近 Release 快照（ADR-0048），故 search 除
    // name/description/当前源码显示名外，还要匹配最近一次发布的 displayName。
    return (stmt.all(term, term, term, term) as (Omit<SkillRecord, 'maintainers'> & { maintainersJson: string })[])
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

  updateReleaseNotes(skillName: string, version: string, notes: string): SkillReleaseRecord | undefined {    const result = this.db.prepare(`
      UPDATE skill_releases
      SET notes = ?
      WHERE skill_name = ? AND version = ?
    `).run(notes, skillName, version);
    if (result.changes === 0) {
      return undefined;
    }
    return this.getRelease(skillName, version);
  }

  /**
   * Mark a release as deprecated (npm-style), or clear the mark with an empty
   * message. The release itself is untouched: it stays installable, it just
   * carries a warning for anyone who lands on it.
   */
  setReleaseDeprecation(
    skillName: string,
    version: string,
    message: string
  ): SkillReleaseRecord | undefined {
    const result = this.db.prepare(`
      UPDATE skill_releases
      SET deprecated_message = ?
      WHERE skill_name = ? AND version = ?
    `).run(message.trim() ? message.trim() : null, skillName, version);
    if (result.changes === 0) {
      return undefined;
    }
    return this.getRelease(skillName, version);
  }

  /**
   * Delete a single Skill Release. The row is kept as a tombstone (who deleted it
   * and when) so the version number stays burned and cannot be republished; the
   * package file, version entry, and release tag are removed by the caller.
   */
  deleteRelease(skillName: string, version: string, deletedBy: string): SkillReleaseRecord | undefined {
    const result = this.db.prepare(`
      UPDATE skill_releases
      SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?
      WHERE skill_name = ? AND version = ? AND deleted_at IS NULL
    `).run(deletedBy, skillName, version);
    if (result.changes === 0) {
      return undefined;
    }
    return this.getRelease(skillName, version, { includeDeleted: true });
  }

  /** Drop a version from the published version list (the tombstone keeps it burned). */
  removeVersion(skillName: string, version: string): void {
    this.db
      .prepare('DELETE FROM skill_versions WHERE skill_name = ? AND version = ?')
      .run(skillName, version);
  }

  /**
   * Skills whose frozen dependency lock points at this exact release. Deleting a
   * release they depend on would break their installs.
   */
  findDependentReleases(skillId: string, version: string): string[] {
    const rows = this.db
      .prepare('SELECT skill_name AS skillName, dependency_lock_json AS dependencyLockJson FROM skill_releases WHERE deleted_at IS NULL')
      .all() as { skillName: string; dependencyLockJson: string }[];
    return rows
      .filter((row) => {
        let lock: Record<string, { skillId?: string; version?: string }>;
        try {
          lock = JSON.parse(row.dependencyLockJson) as Record<string, { skillId?: string; version?: string }>;
        } catch {
          return false;
        }
        return Object.values(lock).some(
          (entry) => entry?.skillId === skillId && entry?.version === version
        );
      })
      .map((row) => row.skillName);
  }

  getRelease(
    skillName: string,
    version: string,
    options: { includeDeleted?: boolean } = {}
  ): SkillReleaseRecord | undefined {
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
        deprecated_message AS deprecatedMessage,
        deleted_at AS deletedAt,
        deleted_by AS deletedBy,
        created_by AS createdBy,
        created_at AS createdAt
      FROM skill_releases
      WHERE skill_name = ? AND version = ?
        AND (? = 1 OR deleted_at IS NULL)
    `).get(skillName, version, options.includeDeleted ? 1 : 0) as ({
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
        deprecated_message AS deprecatedMessage,
        deleted_at AS deletedAt,
        deleted_by AS deletedBy,
        created_by AS createdBy,
        created_at AS createdAt
      FROM skill_releases
      WHERE skill_name = ? AND deleted_at IS NULL
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
  constructor(private readonly db: Database.Database) {
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

  enableUser(username: string): AdminUserRecord {
    const stmt = this.db.prepare(`
      UPDATE admin_users
      SET disabled = 0, updated_at = CURRENT_TIMESTAMP
      WHERE username = ?
    `);
    stmt.run(username);
    const user = this.getUser(username);
    if (!user) {
      throw new Error(`User not found: ${username}`);
    }
    return user;
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

  getLocale(username: string): string | null {
    const row = this.db
      .prepare('SELECT locale FROM admin_users WHERE username = ?')
      .get(username) as { locale: string | null } | undefined;
    return row?.locale ?? null;
  }

  setLocale(username: string, locale: string | null): void {
    this.db
      .prepare('UPDATE admin_users SET locale = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?')
      .run(locale, username);
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

export type OrgApplicationStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';

export interface OrgApplicationRecord {
  id: number;
  orgName: string;
  /** 申请人为已登录的 Skill User（ADR-0032） */
  applicantUsername: string;
  status: OrgApplicationStatus;
  createdAt: string;
  updatedAt: string;
}

export class OrgApplicationRepository {
  constructor(private readonly db: Database.Database) {}

  createApplication(input: { orgName: string; applicantUsername: string }): OrgApplicationRecord {
    // 已了结的旧申请不占用名字（ADR-0032 名字释放）：拒绝/取消/过期，以及
    // 组织已被删除的 approved 旧行，一律重置为待审复用（组织仍存在时上游已拦截）。
    const previous = this.getApplication(input.orgName);
    if (previous && previous.status !== 'pending') {
      const reset = this.updateApplicationStatusById(previous.id, 'pending')!;
      return { ...reset, applicantUsername: input.applicantUsername };
    }
    this.db.prepare(`
      INSERT INTO org_applications (org_name, applicant_username, status)
      VALUES (?, ?, 'pending')
    `).run(input.orgName, input.applicantUsername ?? '');
    return this.getApplication(input.orgName)!;
  }

  getApplication(orgName: string): OrgApplicationRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, org_name, applicant_username, status, created_at, updated_at
      FROM org_applications
      WHERE org_name = ?
    `).get(orgName) as {
      id: number;
      org_name: string;
      applicant_username: string | null;
      admin_display_name: string;
      hashed_password: string;
      encrypted_password: string | null;
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
            SELECT id, org_name, applicant_username, status, created_at, updated_at
            FROM org_applications
            WHERE status = ?
            ORDER BY id ASC
          `).all(status)
        : this.db.prepare(`
            SELECT id, org_name, applicant_username, status, created_at, updated_at
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
      SELECT id, org_name, applicant_username, status, created_at, updated_at
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

  // pending 申请默认保留 30 天,超期统一转为 expired 并返回过期申请,
  // 由调用方同步清理密码密文与租户状态。
  expireStalePending(cutoffIsoDate: string): OrgApplicationRecord[] {
    const expired = (
      this.db.prepare(`
        SELECT id, org_name, applicant_username, status, created_at, updated_at
        FROM org_applications
        WHERE status = 'pending' AND created_at < ?
        ORDER BY id ASC
      `).all(cutoffIsoDate) as Parameters<OrgApplicationRepository['deserialize']>[0][]
    ).map((row) => this.deserialize(row));
    if (expired.length > 0) {
      this.db.prepare(`
        UPDATE org_applications
        SET status = 'expired', updated_at = CURRENT_TIMESTAMP
        WHERE status = 'pending' AND created_at < ?
      `).run(cutoffIsoDate);
    }
    return expired;
  }

  private deserialize(row: {
    id: number;
    org_name: string;
    applicant_username: string | null;
    status: OrgApplicationStatus;
    created_at: string;
    updated_at: string;
  }): OrgApplicationRecord {
    return {
      id: row.id,
      orgName: row.org_name,
      applicantUsername: row.applicant_username ?? '',
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export type UserRegistrationStatus = 'pending' | 'approved' | 'rejected';

export interface UserRegistrationRecord {
  id: number;
  username: string;
  email: string | null;
  status: UserRegistrationStatus;
  createdAt: string;
  updatedAt: string;
}

// 用户注册申请（ADR-0032）：仅 approval 模式使用。账号在注册时即以禁用态
// 创建于 Gitea（名字随之占用），审批 = 解禁，拒绝 = 删除账号并释放名字。
export class UserRegistrationRepository {
  constructor(private readonly db: Database.Database) {}

  create(username: string, email: string): UserRegistrationRecord {
    const existing = this.getByUsername(username);
    if (existing) {
      // 名字被拒绝的注册释放后可再次申请：重置为待审而非新增行。
      this.db.prepare(`
        UPDATE user_registrations
        SET email = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(email, existing.id);
      return this.updateStatusById(existing.id, 'pending')!;
    }
    this.db.prepare(`
      INSERT INTO user_registrations (username, email, status)
      VALUES (?, ?, 'pending')
    `).run(username, email);
    return this.getByUsername(username)!;
  }

  getById(id: number): UserRegistrationRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, username, email, status, created_at, updated_at
      FROM user_registrations
      WHERE id = ?
    `).get(id) as Parameters<UserRegistrationRepository['deserialize']>[0] | undefined;
    return row ? this.deserialize(row) : undefined;
  }

  getByUsername(username: string): UserRegistrationRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, username, email, status, created_at, updated_at
      FROM user_registrations
      WHERE username = ?
    `).get(username) as Parameters<UserRegistrationRepository['deserialize']>[0] | undefined;
    return row ? this.deserialize(row) : undefined;
  }

  getPendingByEmail(email: string): UserRegistrationRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, username, email, status, created_at, updated_at
      FROM user_registrations
      WHERE email = ? AND status = 'pending'
    `).get(email) as Parameters<UserRegistrationRepository['deserialize']>[0] | undefined;
    return row ? this.deserialize(row) : undefined;
  }

  listByStatus(status: UserRegistrationStatus): UserRegistrationRecord[] {
    const rows = this.db.prepare(`
      SELECT id, username, email, status, created_at, updated_at
      FROM user_registrations
      WHERE status = ?
      ORDER BY id ASC
    `).all(status) as Parameters<UserRegistrationRepository['deserialize']>[0][];
    return rows.map((row) => this.deserialize(row));
  }

  updateStatusById(id: number, status: UserRegistrationStatus): UserRegistrationRecord | undefined {
    this.db.prepare(`
      UPDATE user_registrations
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, id);
    return this.getById(id);
  }

  private deserialize(row: {
    id: number;
    username: string;
    email: string | null;
    status: UserRegistrationStatus;
    created_at: string;
    updated_at: string;
  }): UserRegistrationRecord {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export type OrgInvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export interface OrgInvitationRecord {
  id: number;
  orgName: string;
  username: string;
  invitedBy: string;
  status: OrgInvitationStatus;
  createdAt: string;
  updatedAt: string;
}

// 组织邀请（ADR-0032）：邀请制拉人方式下，所有者成员发出邀请，
// 被邀请人接受后加入组织并自动进入三个技能授权团队（ADR-0038）。
export class OrgInvitationRepository {
  constructor(private readonly db: Database.Database) {}

  create(orgName: string, username: string, invitedBy: string): OrgInvitationRecord {
    // 同名待处理邀请唯一（UNIQUE(org,username,status)）：复用已有 pending 记录。
    const existing = this.db.prepare(`
      SELECT id FROM org_invitations
      WHERE org_name = ? AND username = ? AND status = 'pending'
    `).get(orgName, username) as { id: number } | undefined;
    if (existing) {
      return this.getById(existing.id)!;
    }
    this.db.prepare(`
      INSERT INTO org_invitations (org_name, username, invited_by, status)
      VALUES (?, ?, ?, 'pending')
    `).run(orgName, username, invitedBy);
    return this.getById(
      (this.db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id
    )!;
  }

  getById(id: number): OrgInvitationRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, org_name, username, invited_by, status, created_at, updated_at
      FROM org_invitations
      WHERE id = ?
    `).get(id) as Parameters<OrgInvitationRepository['deserialize']>[0] | undefined;
    return row ? this.deserialize(row) : undefined;
  }

  listByOrg(orgName: string, status: OrgInvitationStatus = 'pending'): OrgInvitationRecord[] {
    const rows = this.db.prepare(`
      SELECT id, org_name, username, invited_by, status, created_at, updated_at
      FROM org_invitations
      WHERE org_name = ? AND status = ?
      ORDER BY id ASC
    `).all(orgName, status) as Parameters<OrgInvitationRepository['deserialize']>[0][];
    return rows.map((row) => this.deserialize(row));
  }

  listForUser(username: string, status: OrgInvitationStatus = 'pending'): OrgInvitationRecord[] {
    const rows = this.db.prepare(`
      SELECT id, org_name, username, invited_by, status, created_at, updated_at
      FROM org_invitations
      WHERE username = ? AND status = ?
      ORDER BY id ASC
    `).all(username, status) as Parameters<OrgInvitationRepository['deserialize']>[0][];
    return rows.map((row) => this.deserialize(row));
  }

  updateStatusById(id: number, status: OrgInvitationStatus): OrgInvitationRecord | undefined {
    this.db.prepare(`
      UPDATE org_invitations
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, id);
    return this.getById(id);
  }

  private deserialize(row: {
    id: number;
    org_name: string;
    username: string;
    invited_by: string;
    status: OrgInvitationStatus;
    created_at: string;
    updated_at: string;
  }): OrgInvitationRecord {
    return {
      id: row.id,
      orgName: row.org_name,
      username: row.username,
      invitedBy: row.invited_by,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export type TenantOrganizationStatus =
  | 'pending'
  | 'active'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'deleting'
  | 'delete_failed'
  | 'deleted';

export interface TenantOrganizationRecord {
  orgName: string;
  status: TenantOrganizationStatus;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export class TenantOrganizationRepository {
  constructor(private readonly db: Database.Database) {}

  // 幂等登记（ADR-0032 名字释放）：名字被拒绝/取消/删除后再次启用同一名字时
  // 记录已存在，这里回到目标状态而不是撞主键（旧记录只剩状态语义）。
  create(input: {
    orgName: string;
    status?: TenantOrganizationStatus;
  }): TenantOrganizationRecord {
    const transaction = this.db.transaction(() => {
      const existing = this.get(input.orgName);
      if (existing) {
        return this.transition(input.orgName, input.status ?? 'active')!;
      }
      this.db.prepare(`
        INSERT INTO tenant_organizations (org_name, status)
        VALUES (?, ?)
      `).run(input.orgName, input.status ?? 'pending');
      return this.get(input.orgName)!;
    });
    return transaction() as TenantOrganizationRecord;
  }

  get(orgName: string): TenantOrganizationRecord | undefined {
    const row = this.db.prepare(`
      SELECT org_name, status, last_error_json, created_at, updated_at
      FROM tenant_organizations
      WHERE org_name = ?
    `).get(orgName) as {
      org_name: string;
      status: TenantOrganizationStatus;
      last_error_json: string | null;
      created_at: string;
      updated_at: string;
    } | undefined;
    if (!row) return undefined;
    return {
      orgName: row.org_name,
      status: row.status,
      lastError: row.last_error_json ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  listAll(): TenantOrganizationRecord[] {
    const rows = this.db.prepare(`
      SELECT org_name, status, last_error_json, created_at, updated_at
      FROM tenant_organizations
      ORDER BY org_name ASC
    `).all() as {
      org_name: string;
      status: TenantOrganizationStatus;
      last_error_json: string | null;
      created_at: string;
      updated_at: string;
    }[];
    return rows.map((row) => ({
      orgName: row.org_name,
      status: row.status,
      lastError: row.last_error_json ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  transition(
    orgName: string,
    status: TenantOrganizationStatus,
    error?: string
  ): TenantOrganizationRecord | undefined {
    const transaction = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE tenant_organizations
        SET status = ?, last_error_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE org_name = ?
      `).run(status, error ?? null, orgName);
      return result.changes > 0 ? this.get(orgName) : undefined;
    });
    return transaction() as TenantOrganizationRecord | undefined;
  }

  // 团队显示名(ADR-0029):ESL 侧纯展示字段,键按 Gitea team ID——标识名改名
  // (Gitea 挂载按 ID 引用)不丢显示名。未设置返回 undefined。
  getTeamDisplayName(orgName: string, giteaTeamId: number): string | undefined {
    const row = this.db.prepare(`
      SELECT display_name
      FROM org_team_profiles
      WHERE org_name = ? AND gitea_team_id = ?
    `).get(orgName, giteaTeamId) as { display_name: string | null } | undefined;
    return row?.display_name ?? undefined;
  }

  // 写入团队显示名;displayName 传 null 即清空。不存在则插入,存在则覆盖。
  setTeamDisplayName(orgName: string, giteaTeamId: number, displayName: string | null): void {
    this.db.prepare(`
      INSERT INTO org_team_profiles (org_name, gitea_team_id, display_name, created_at, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(org_name, gitea_team_id) DO UPDATE SET
        display_name = excluded.display_name,
        updated_at = CURRENT_TIMESTAMP
    `).run(orgName, giteaTeamId, displayName);
  }

  // 自定义团队删除后清理其显示名记录,不留孤儿数据。
  deleteTeamProfile(orgName: string, giteaTeamId: number): void {
    this.db.prepare(`
      DELETE FROM org_team_profiles
      WHERE org_name = ? AND gitea_team_id = ?
    `).run(orgName, giteaTeamId);
  }
}

export type SkillPermission = 'read' | 'write' | 'manage';

export interface SkillTeamGrant {
  skillName: string;
  teamId: number;
  permission: SkillPermission;
}

export class SkillTeamGrantRepository {
  constructor(private readonly db: Database.Database) {}

  set(skillName: string, teamId: number, permission: SkillPermission): void {
    this.db.prepare(`
      INSERT INTO skill_team_grants (skill_name, team_id, permission, created_at, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(skill_name, team_id) DO UPDATE SET
        permission = excluded.permission,
        updated_at = CURRENT_TIMESTAMP
    `).run(skillName, teamId, permission);
  }

  remove(skillName: string, teamId: number): void {
    this.db.prepare(`
      DELETE FROM skill_team_grants
      WHERE skill_name = ? AND team_id = ?
    `).run(skillName, teamId);
  }

  list(skillName: string): Array<{ teamId: number; permission: SkillPermission }> {
    const rows = this.db.prepare(`
      SELECT team_id AS teamId, permission
      FROM skill_team_grants
      WHERE skill_name = ?
      ORDER BY team_id ASC
    `).all(skillName) as Array<{ teamId: number; permission: SkillPermission }>;
    return rows;
  }

  removeByTeam(teamId: number): void {
    this.db.prepare('DELETE FROM skill_team_grants WHERE team_id = ?').run(teamId);
  }

  listByTeam(teamId: number): Array<{ skillName: string; permission: SkillPermission }> {
    return this.db.prepare(`
      SELECT skill_name AS skillName, permission
      FROM skill_team_grants
      WHERE team_id = ?
      ORDER BY skill_name ASC
    `).all(teamId) as Array<{ skillName: string; permission: SkillPermission }>;
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM skill_team_grants').run();
  }

  clearAllForSkill(skillName: string): void {
    this.db.prepare('DELETE FROM skill_team_grants WHERE skill_name = ?').run(skillName);
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
  if (row.displayName) skill.displayName = row.displayName;
  if (row.skillId) skill.skillId = row.skillId;
  if (row.skillId && row.status) skill.status = row.status;
  if (row.deletionRequestedBy) skill.deletionRequestedBy = row.deletionRequestedBy;
  if (row.deletionReason) skill.deletionReason = row.deletionReason;
  if (row.deletionError) skill.deletionError = row.deletionError;
  if (row.deletionRequestedAt) skill.deletionRequestedAt = row.deletionRequestedAt;
  return skill;
}

function createSkillId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = crypto.randomBytes(26);
  return `sk_${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')}`;
}
