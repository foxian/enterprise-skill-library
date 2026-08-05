import Database from 'better-sqlite3';
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
