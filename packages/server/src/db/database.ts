import Database from 'better-sqlite3';
import { databaseSchema } from './schema.js';

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(databaseSchema);
  return db;
}

export interface SkillRecord {
  name: string;
  scope: string;
  skillName: string;
  description: string;
  author: string;
  visibility: string;
  gitRepoPath: string;
}

export class SkillRepository {
  constructor(private readonly db: Database.Database) {}

  createSkill(skill: SkillRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO skills (name, scope, skill_name, description, author, visibility, git_repo_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      skill.name,
      skill.scope,
      skill.skillName,
      skill.description,
      skill.author,
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
        author,
        visibility,
        git_repo_path AS gitRepoPath
      FROM skills
      WHERE name = ?
    `);
    return stmt.get(name) as SkillRecord | undefined;
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
        author,
        visibility,
        git_repo_path AS gitRepoPath
      FROM skills
      WHERE name LIKE ? OR description LIKE ?
    `);
    const term = `%${query}%`;
    return stmt.all(term, term) as SkillRecord[];
  }
}
