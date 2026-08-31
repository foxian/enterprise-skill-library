export const databaseSchema = `
  CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    skill_id TEXT UNIQUE,
    scope TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    description TEXT NOT NULL,
    author TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT 'platform',
    maintainers_json TEXT NOT NULL DEFAULT '[]',
    visibility TEXT NOT NULL DEFAULT 'public',
    status TEXT NOT NULL DEFAULT 'published',
    git_repo_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS skill_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_name TEXT NOT NULL,
    version TEXT NOT NULL,
    readme TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (skill_name) REFERENCES skills(name) ON DELETE CASCADE,
    UNIQUE(skill_name, version)
  );

  CREATE TABLE IF NOT EXISTS skill_tags (
    skill_name TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (skill_name, tag),
    FOREIGN KEY (skill_name) REFERENCES skills(name) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS skill_identity_redirects (
    old_name TEXT PRIMARY KEY,
    skill_id TEXT NOT NULL,
    current_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS skill_releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    version TEXT NOT NULL,
    source_commit TEXT NOT NULL,
    package_path TEXT NOT NULL,
    checksum TEXT NOT NULL,
    release_manifest_json TEXT NOT NULL,
    dependency_lock_json TEXT NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(skill_id, version),
    FOREIGN KEY (skill_name) REFERENCES skills(name) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    username TEXT PRIMARY KEY,
    disabled INTEGER NOT NULL DEFAULT 0,
    platform_admin INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admin_tokens (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES admin_users(username) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS org_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_name TEXT NOT NULL UNIQUE,
    admin_display_name TEXT NOT NULL,
    hashed_password TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;
