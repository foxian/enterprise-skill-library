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

  CREATE TABLE IF NOT EXISTS tenant_organizations (
    org_name TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'provisioning'
      CHECK (status IN ('pending', 'provisioning', 'active', 'failed', 'rejected', 'cancelled', 'expired', 'deleting', 'delete_failed')),
    operation_id INTEGER,
    last_error_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS tenant_organizations_status_index
    ON tenant_organizations (status, updated_at);

  CREATE TABLE IF NOT EXISTS operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idempotency_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'permanently_failed')),
    payload_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    next_retry_at DATETIME,
    lease_owner TEXT,
    lease_until DATETIME,
    error_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS operations_claim_index
    ON operations (status, next_retry_at, lease_until, id);

  CREATE TABLE IF NOT EXISTS operation_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id INTEGER NOT NULL,
    event TEXT NOT NULL,
    actor TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS operation_audits_operation_index
    ON operation_audits (operation_id, id);

  CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;
