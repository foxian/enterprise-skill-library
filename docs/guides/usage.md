# Enterprise Skill Library (ESL) 使用指南

Enterprise Skill Library (ESL) 是一个企业级 AI Agent 技能注册与管理平台。它为企业内部团队提供统一的技能发现、校验、发布、安装与多 AI Agent 目录适配能力。

---

## 一、 核心概念 (Core Concepts)

| 概念 | 说明 | 示例 |
| :--- | :--- | :--- |
| **技能标识 (Skill Identity)** | 技能的全局唯一名称，格式为 `@namespace/skill-name`。 | `@cnfox/code-review` |
| **本地命名空间 (`@local`)** | 专为本地草稿、测试预留的命名空间。自带发布防护，防止未审核测试代码误发布到服务器。 | `@local/my-test-skill` |
| **真实源存储 (`.skills/`)** | 项目根目录下统一存储技能文件的目录（真相源），不受各 AI 工具特殊目录结构影响。 | `.skills/@cnfox/code-review/` |
| **依赖清单与锁文件** | `.skills.json` 记录声明依赖；`.skills-lock.json` 精确锁定版本与 SHA-256 完整性哈希。 | `.skills.json`<br>`.skills-lock.json` |
| **适配引擎 (Adapt Engine)** | 将 `.skills/` 中的标准技能全量同步映射到各种 AI 工具配置目录的机制（零 Symlink 复制）。 | `.claude/skills/`<br>`.trae/skills/` |

---

## 二、 环境配置与登录 (Setup & Login)

### 1. 本地服务启动 (仅本地开发环境)

本地运行 ESL Server 的环境准备、Docker 启动和管理员初始化，请参阅
[本地开发指南](local-development.md)。正常使用只需要访问 ESL Server；
Gitea 是内部 Git Backend，不需要直接配置或登录。

### 2. 登录认证 (Login)

#### 配置 ESL Server 地址（只需一次）
ESL CLI 从本地配置读取 Server 地址，所有命令（含登录）都默认使用该地址。
首次使用前设置一次即可，之后不再需要 `--server`：

```powershell
esl config set-server http://localhost:3000
```

默认本地 Docker 地址是 `http://localhost:3000`。

#### 交互式登录（推荐）
`esl login` 会依次提示输入 `Organization:`、`Username:` 与 `Password:`
（**组织必填**，密码隐藏显示）。登录成功后凭据写入本地，后续命令无需再传
账号与地址：

```powershell
esl login
```

#### 指定账号 / 非交互登录
也可以显式传 `--org` / `--username` / `--server`，或使用文件提供凭据。
ESL CLI 只服务组织内成员，组织账号由服务端解析为 `<org>_<username>` 并校验
归属；组织管理员的用户名为 `admin`：

```powershell
# 指定组织与账号交互登录
esl login --org acme --username alice

# 用密码文件登录（脚本 / CI）
esl login --org acme --username alice --password-file ./pw.txt

# 用用户 token 文件登录
esl login --org acme --username alice --token-file ./user-token.txt
```

平台管理员不通过 CLI 登录：打开管理后台（`http://<server>/admin/`），使用
`GITEA_ADMIN_USERNAME` 账号（默认 `eslroot`）与密码登录。

登录后的 token 默认 30 天有效，过期后需重新登录；可通过环境变量
`ESL_LOGIN_TTL_HOURS` 调整有效期（单位：小时）。

#### 查看当前登录状态
```powershell
esl whoami
```

输出当前登录的用户名、所属组织、角色（organization administrator /
member）、Server、登录时间、过期时间与状态（`active` / `expired` /
`Not logged in`）。

CLI 不支持在命令行明文传 token/密码。登录成功后 token 会写入用户目录下的
凭据文件（仅所有者可读），不会写入 `config.json`。

需要直接登录 Gitea 网页后台进行恢复或诊断时，请参阅
[Docker 排障指南](docker-troubleshooting.md)。

### 3. 平台管理员操作 (Admin)

平台管理员的治理操作（组织审批、组织管理、平台设置、管理员改密）全部在
**管理后台**（`/admin/`）完成；ESL CLI 不提供平台管理员登录，只面向
组织内成员与组织管理员。

### 4. 账户自助管理 (Account)

组织成员可修改自己的登录密码。需要验证当前密码，新密码二次确认：

```powershell
esl account change-password
```

平台管理员（ESL Administrator Account）改密在**管理后台 → 平台设置**中
完成，不使用 CLI。

---

## 三、 技能使用者指南 (Skill Consumer Workflow)

如果你是技能的使用者，希望在项目或个人开发环境中使用团队共享的技能：

### 1. 搜索技能 (Search)
在 ESL Server 搜索可用技能：
```bash
esl search code-review

# 输出 JSON 结构化数据
esl search code-review --json
```

### 2. 查看技能详情 (Info)
查看指定技能的元数据、版本及源码信息：
```bash
# 人类可读摘要（默认）
esl info @cnfox/code-review

# 输出完整 JSON 结构
esl info @cnfox/code-review --json
```

### 3. 免安装试用技能 (Use)
临时读取技能的 Prompt 文本并输出到控制台，无需安装或修改项目依赖（支持管道传递给 Agent）：
```bash
# 试用远端技能并直接输出 Prompt
esl use @cnfox/code-review

# 指定版本号试用
esl use @cnfox/code-review --version 1.0.0

# 试用本地草稿技能
esl use ./path/to/my-skill

# 通过管道传递给 Agent (如 Claude Code)
esl use @cnfox/code-review | claude "请帮助审核当前的 git diff"
```

### 4. 安装技能 (Install)
将技能安装至当前项目：
```bash
# 从 ESL Server 安装最新版本
esl install @cnfox/code-review

# 安装指定版本
esl install @cnfox/code-review --version 1.0.0

# 从本地相对路径安装（身份固定为 @local/<name>；在安装副本里补 skill.json，源目录不动）
esl install ./path/to/my-skill

# 安装到个人全局环境 (~/.skill-library/skills/)
esl install @cnfox/code-review --global

# 安装但跳过自动 adapt 同步
esl install @cnfox/code-review --no-adapt
```
> **提示**：安装完成后，`esl install` 会自动运行 `adapt` 引擎将技能同步分发到所有已配置的 AI Agent 目录中。

### 5. 查看已安装技能 (List)
查看当前项目或全局已安装的技能清单：
```bash
# 查看当前项目安装的技能
esl list
# 或简写
esl ls

# 查看全局安装的技能
esl list --global

# 输出 JSON 结构化数据
esl list --json
```

### 6. 手动同步适配 (Adapt)
将已安装的技能同步刷入项目配置的各个 AI 工具中（如 Claude Code, Trae 等）：
```bash
# 刷入当前项目
esl adapt

# 刷入全局 AI 工具目录
esl adapt --global
```

### 7. 更新技能 (Update)
检查并升级已安装的技能到 ESL Server 上的最新版本：
```bash
# 更新项目下所有技能
esl update

# 更新指定的某个技能
esl update @cnfox/code-review

# 更新全局技能
esl update --global
```

### 8. 卸载技能 (Uninstall)
移除已安装的技能（自动清理 `.skills/` 目录、依赖清单及各 AI 工具中的副本）：
```bash
# 卸载项目技能
esl uninstall @cnfox/code-review

# 卸载全局技能
esl uninstall @cnfox/code-review --global
```

---

## 五、 技能开发者指南 (Skill Author Workflow)

如果你是技能的开发者，希望创建、校验并发布新技能：

### 1. 初始化技能模板 (Init)
脚手架初始化一个新的技能目录：
```bash
# 在当前目录下创建 my-skill 文件夹，技能标识为 @cnfox/my-skill
esl init @cnfox/my-skill

# 指定许可证（默认 MIT）
esl init @cnfox/my-skill --license Apache-2.0
```
将会生成包含 `SKILL.md`（带 YAML Frontmatter）与 `release.json` 的源码骨架。源码形态的发布输入是 `SKILL.md` + `release.json`；`skill.json` 不属于源码，只作为安装副本或发布包的生成物。

### 2. 校验技能规范 (Validate)
在发布前检查技能结构、`SKILL.md` 规范与 `release.json` 元数据是否合法：
```bash
esl validate ./my-skill
```

### 3. 上传源码 (Upload)
把本地源码提交并推送到服务器成为 Server-hosted Skill Source（首次创建 Skill ID 与 `esl` remote，之后对已托管源直接同步）：
```bash
esl upload --directory ./my-skill

# 目录缺 release.json 时自动补清单，可指定许可证
esl upload --directory ./my-skill --license Apache-2.0

# 用一句话说明本次上传内容（作为源码提交说明）
esl upload --directory ./my-skill --message "fix: correct the dead-link regex"
```
`upload` 自动完成 git 前置：非 git 仓库自动 `git init`、缺失时补基础 `.gitignore`、有未提交改动（含自动补的 `release.json`）时自动 `git add -A` + commit；已托管源推前自动 rebase 到服务器最新，冲突时保留现场并提示解决后重跑。本地已与服务器一致时报告 `already up to date`。查看本地与服务器源的差异状态：

```bash
esl status
```
> **源被删除后的恢复**：若服务器源已被管理员删除而本地仍保留技能目录，`esl upload` 会识别为孤儿场景——交互模式提示"是否移除 esl remote 并重新登记"，同意则自动 `git remote remove esl` 后全新登记；拒绝或非交互则给出 `git remote remove esl` → `esl upload --directory .` 的手动指引。

### 4. 发布技能 (Publish)
将当前已推送的源码 HEAD 发布为 Skill Release 到 ESL Server：
```bash
cd my-skill
esl publish 0.1.0

# 指定版本说明（作为发布说明与 release tag 说明）
esl publish 0.1.0 --message "fix: dead-link regex; feat: docx batch"

# 跳过交互确认（脚本 / 非交互）
esl publish 0.1.0 --force
```
> 不传 `--message` 时，`publish` 自动收集"自上一个 release tag 以来的 commit 说明"作为版本说明；交互模式会展示让你确认/修改，直接回车即用默认。版本说明存入 release 记录（API 可查，供消费者判断是否升级）与 release tag。发布后如需修订说明：

```bash
esl notes @platform-ai/reviewer 1.1.0 --message "修订后的版本说明"
```
> **注意**：名称为 `@local/*` 的技能将被系统拦截，无法直接发布；发布身份（scope 即其 Namespace）由 Platform Organization 锁定，不能从登录用户推断。
> `publish` 要求目录含 `release.json`；缺失时自动补最小清单（`schemaVersion: 1`，`license` 由用户显式确认）并落盘。若尚无 `esl` remote 会报错并提示先 `esl upload`。
> `esl publish` 发布前会要求确认；使用 `--force`（`-f`）可跳过确认，或配合全局 `--no-input` 在自动化中失败即止。

### 5. 升级版本号 (Version)
源码形态（`SKILL.md` + `release.json`）的技能不存储本地版本号，`esl version` 对它不可用；发新版直接指定 SemVer：
```bash
# 源码形态：直接向 publish 传 SemVer
esl publish 0.2.0   # minor
esl publish 0.2.1   # patch
esl publish 1.0.0   # major
```
`esl version minor|patch|major` 仍可用于含 `skill.json` 的安装副本或包形态目录。

### 6. 克隆远端源码进行二次开发 (Source)
若需要对别人发布的技能进行二次开发或修复 Bug，可直接获取其完整 Git 源码：
```bash
# 将 @cnfox/code-review 的 Git 源码克隆到当前目录
esl source @cnfox/code-review

# 克隆到指定目录
esl source @cnfox/code-review ./custom-dir
```

---

## 六、 多 Agent 工具配置与目录映射 (Multi-Agent Adaptation Reference)

当运行 `esl adapt` 或 `esl install` 时，系统根据配置自动将技能全量复制（零 Symlink）到对应的 AI Agent 工作区中。

| 工具名称 (`tools`) | 项目级安装路径 (Project) | 全局安装路径 (Global) |
| :--- | :--- | :--- |
| `claude` | `<project>/.claude/skills/<skill-name>/` | `~/.claude/skills/<skill-name>/` |
| `trae` | `<project>/.trae/skills/<skill-name>/` | `~/.trae/skills/<skill-name>/` |
| `trae-cn` | `<project>/.trae/skills/<skill-name>/` | `~/.trae-cn/skills/<skill-name>/` |
| `codex` | `<project>/.agents/skills/<skill-name>/` | `~/.agents/skills/<skill-name>/` |

你可以通过修改项目下的 `.skills.json` 文件来自定义当前项目需要适配的工具列表：
```json
{
  "skills": {
    "@cnfox/code-review": "^1.0.0"
  },
  "tools": ["claude", "trae", "codex"]
}
```
