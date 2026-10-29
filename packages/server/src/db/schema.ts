export const databaseSchema = `
  CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    skill_id TEXT UNIQUE,
    scope TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    description TEXT NOT NULL,
    display_name TEXT,
    author TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT 'platform',
    maintainers_json TEXT NOT NULL DEFAULT '[]',
    visibility TEXT NOT NULL DEFAULT 'public',
    status TEXT NOT NULL DEFAULT 'published',
    git_repo_path TEXT NOT NULL,
    deletion_requested_by TEXT,
    deletion_reason TEXT,
    deletion_error TEXT,
    deletion_requested_at DATETIME,
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
    locale TEXT,
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

  CREATE TABLE IF NOT EXISTS skill_team_grants (
    skill_name TEXT NOT NULL,
    team_id INTEGER NOT NULL,
    permission TEXT NOT NULL CHECK (permission IN ('read', 'write', 'manage')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (skill_name, team_id),
    FOREIGN KEY (skill_name) REFERENCES skills(name) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS skill_team_grants_team_index
    ON skill_team_grants (team_id);

  -- 组织邀请（ADR-0032）：邀请制拉人方式下的入组凭证，被邀请人接受后入组。
  CREATE TABLE IF NOT EXISTS org_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_name TEXT NOT NULL,
    username TEXT NOT NULL,
    invited_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 真正的不变量是"同一 (组织, 用户) 最多一条**待处理**邀请"，不是"同终态只一条"。
  -- 早先的 UNIQUE(org_name, username, status) 会让"邀请 → 拒绝 → 再邀请 → 再拒绝"
  -- （以及撤销同理）在第二次终态翻转时撞唯一约束。历史行可以有任意多条。
  CREATE UNIQUE INDEX IF NOT EXISTS org_invitations_pending_unique
    ON org_invitations (org_name, username) WHERE status = 'pending';

  -- Skill 删除审计独立于 skills 记录保存：技能被物理删除后，审计必须仍能
  -- 说明是谁、为什么删除了哪个 Identity，以及删除时有哪些依赖方。
  CREATE TABLE IF NOT EXISTS skill_deletion_audits (
    skill_id TEXT,
    full_name TEXT NOT NULL,
    scope TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    deleted_by TEXT NOT NULL,
    reason TEXT NOT NULL,
    releases_removed INTEGER NOT NULL,
    dependents_json TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- 用户注册申请（ADR-0032）：approval 模式下账号先建后禁用，审批激活、
  -- 拒绝删除（名字随之释放）。open 模式不写此表。
  CREATE TABLE IF NOT EXISTS user_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 出站邮件动作（ADR-0050）：原始 token 只出现在邮件链接中，数据库仅保存哈希。
  CREATE TABLE IF NOT EXISTS email_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purpose TEXT NOT NULL CHECK (purpose IN ('register', 'email_change', 'password_reset')),
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    password_ciphertext TEXT,
    previous_email TEXT,
    expires_at DATETIME NOT NULL,
    claimed_at DATETIME,
    consumed_at DATETIME,
    superseded_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS email_actions_lookup_index
    ON email_actions (purpose, username, expires_at);

  CREATE UNIQUE INDEX IF NOT EXISTS email_actions_pending_email_unique
    ON email_actions (email)
    WHERE purpose IN ('register', 'email_change')
      AND consumed_at IS NULL
      AND superseded_at IS NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS email_actions_pending_identity_unique
    ON email_actions (purpose, username)
    WHERE consumed_at IS NULL
      AND superseded_at IS NULL;

  -- 下载日志明细（ADR-0067）：每次包发放尝试记录一条——成功发放计一次下载，
  -- 失败发放（未认证/无读权限/包不存在）同样落行但不计数，使失败模式可观测。
  -- client_ip_truncated 只存截断后的网段（IPv4 /24、IPv6 /48），任何路径都不落
  -- 全量 IP；客户端环境字段来自 User-Agent 解析，缺失或解析失败为 NULL。
  -- 明细仅 Super Administrator 可查，保留 90 天后由清理任务删除。
  CREATE TABLE IF NOT EXISTS download_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id TEXT,
    skill_identity TEXT,
    version TEXT,
    requested_specifier TEXT,
    user_id TEXT,
    username TEXT,
    client_ip_truncated TEXT,
    os_platform TEXT,
    os_arch TEXT,
    esl_version TEXT,
    node_version TEXT,
    downloaded_at DATETIME NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
    failure_reason TEXT
  );

  CREATE INDEX IF NOT EXISTS download_logs_skill_index
    ON download_logs (skill_id, downloaded_at);

  CREATE INDEX IF NOT EXISTS download_logs_user_index
    ON download_logs (username, downloaded_at);

  -- 清理任务按 downloaded_at 扫描过期明细（ADR-0067）。
  CREATE INDEX IF NOT EXISTS download_logs_downloaded_at_index
    ON download_logs (downloaded_at);

  -- 聚合计数（ADR-0067）：与明细独立、永久保留，公开下载量由此读取。
  -- 汇总层用空串而非 NULL 表达"不限"维度——SQLite 唯一约束把 NULL 视为互不
  -- 相等，(skill_id,'',day) 会重复插入。三个维度分别是：
  --   version='' AND day=''  → 技能跨版本总量
  --   version!='' AND day='' → 该版本总量
  --   version='' AND day!='' → 该日桶（近 30 天口径的数据基础）
  CREATE TABLE IF NOT EXISTS download_counts (
    skill_id TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '',
    day TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (skill_id, version, day)
  );

  -- Server 实例身份（ADR-0071）：首次初始化生成随机 UUID，之后只读。单行表，
  -- id 固定为 1；重启、升级、备份恢复都复用同一值，独立部署各自生成新值。
  CREATE TABLE IF NOT EXISTS server_identity (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    instance_id TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;
