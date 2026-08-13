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
  db.exec(`
    UPDATE skills
    SET created_by = author
    WHERE created_by = ''
  `);
  return db;
}

function ensureColumn(db: Database.Database, column: string, definition: string): void {
  const columns = db.pragma('table_info(skills)') as { name: string }[];
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE skills ADD COLUMN ${column} ${definition}`);
  }
}

export interface SkillRecord {
  name: string;
  scope: string;
  skillName: string;
  description: string;
  createdBy: string;
  owner: string;
  maintainers: string[];
  visibility: string;
  gitRepoPath: string;
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

  getSkill(name: string): SkillRecord | undefined {
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
      WHERE name = ?
    `);
    const row = stmt.get(name) as (Omit<SkillRecord, 'maintainers'> & { maintainersJson: string }) | undefined;
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
      WHERE name LIKE ? OR description LIKE ?
    `);
    const term = `%${query}%`;
    return (stmt.all(term, term) as (Omit<SkillRecord, 'maintainers'> & { maintainersJson: string })[])
      .map(deserializeSkill);
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

  getBootstrapStatus(repoOwnerReady: boolean): {
    ready: boolean;
    registry: 'configured';
    admin: 'ready';
    repoOwner: 'ready' | 'missing';
  } {
    return {
      ready: repoOwnerReady,
      registry: 'configured',
      admin: 'ready',
      repoOwner: repoOwnerReady ? 'ready' : 'missing'
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
    const user = this.getUser(username);
    if (!user) {
      throw new Error(`User not found: ${username}`);
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

  changePassword(username: string, password: string): void {
    const stmt = this.db.prepare(`
      UPDATE admin_users
      SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE username = ?
    `);
    const result = stmt.run(hashSecret(password), username);
    if (result.changes === 0) {
      throw new Error(`User not found: ${username}`);
    }
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

function hashToken(token: string): string {
  return hashSecret(token);
}

function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function deserializeSkill(
  row: Omit<SkillRecord, 'maintainers'> & { maintainersJson: string }
): SkillRecord {
  return {
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
}
