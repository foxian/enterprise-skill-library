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
    deprecated_message TEXT,
    deleted_at DATETIME,
    deleted_by TEXT,
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
    applicant_username TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tenant_organizations (
    org_name TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'active', 'failed', 'rejected', 'cancelled', 'expired', 'deleting', 'delete_failed', 'deleted')),
    last_error_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS tenant_organizations_status_index
    ON tenant_organizations (status, updated_at);

  CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS org_team_profiles (
    org_name TEXT NOT NULL,
    gitea_team_id INTEGER NOT NULL,
    display_name TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (org_name, gitea_team_id)
  );

  -- 组织邀请（ADR-0032）：邀请制拉人方式下的入组凭证，被邀请人接受后入组。
  CREATE TABLE IF NOT EXISTS org_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_name TEXT NOT NULL,
    username TEXT NOT NULL,
    invited_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (org_name, username, status)
  );

  -- 用户注册申请（ADR-0032）：approval 模式下账号先建后禁用，审批激活、
  -- 拒绝删除（名字随之释放）。open 模式不写此表。
  CREATE TABLE IF NOT EXISTS user_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;
