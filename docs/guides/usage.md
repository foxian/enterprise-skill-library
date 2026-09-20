# Enterprise Skill Library (ESL) 使用指南

Enterprise Skill Library (ESL) 是一个企业级 AI Agent 技能注册与管理平台。它为企业内部团队提供统一的技能发现、校验、发布、安装与多 AI Agent 目录适配能力。

---

## 一、 核心概念 (Core Concepts)

| 概念 | 说明 | 示例 |
| :--- | :--- | :--- |
| **技能标识 (Skill Identity)** | 技能的全局唯一名称，格式为 `@namespace/skill-name`。 | `@cnfox/code-review` |
| **本地命名空间 (`@local`)** | 专为本地草稿、测试预留的命名空间。自带发布防护，防止未审核测试代码误发布到服务器。 | `@local/my-test-skill` |
| **Skill Store (`.eslib/`)** | 项目级使用 `<project>/.eslib/skills/`，全局级使用 `~/.eslib/skills/`；技能源按 npm 风格放在 `@scope/skill-name/` 下。 | `.eslib/skills/@cnfox/code-review/` |
| **依赖清单与锁文件** | `.skills.json` 记录声明依赖；`.skills-lock.json` 精确锁定版本与 SHA-256 完整性哈希。 | `.skills.json`<br>`.skills-lock.json` |
| **Tool Link** | 每个 AI 工具目录中的单个技能目录 link，指向 Skill Store 源；link 名仍使用安全目录名 `scope_skill-name`。 | `.claude/skills/cnfox_code-review -> .eslib/skills/@cnfox/code-review` |
| **Skill Source Link** | 本地技能源码目录在 Skill Store 中的符号链接安装；开发中修改源码后，链接工具立即看到。 | `.eslib/skills/@local/my-skill -> ./my-skill` |

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

# 安装到个人全局环境 (~/.eslib/skills/)
esl install @cnfox/code-review --global

# 链接到全部或指定 AI 工具
esl install @cnfox/code-review --tools all
esl install @cnfox/code-review --tools claude-code,codex,trae-intl

# 只安装源，不创建 Tool Link
esl install @cnfox/code-review --no-tools
```
> **提示**：项目级技能源写入 `.eslib/skills/`，全局级写入 `~/.eslib/skills/`。每个目标工具只得到一个指向该源的目录 link，不再复制技能。未传 `--tools` 时，按项目 `.skills.json`、全局配置、交互选择的顺序解析默认工具。

### 5. 本地源码开发链接 (Link)
在持续开发本地技能时，把源码目录链入 Skill Store，避免每次修改都重新安装：
```bash
# 链接当前目录；裸短名默认使用 @local
esl link ./path/to/my-skill

# 显式补全 namespace；不能改 release.json 或 SKILL.md 中的短名
esl link ./path/to/my-skill --identity acme

# 链接到全局 Skill Store
esl link ./path/to/my-skill --global

# 替换同身份的普通安装副本；原副本移入 .eslib/link-staging/
esl link ./path/to/my-skill --force
```

`link` 身份优先取 `release.json` 的完整 `@scope/name`；裸短名默认 `@local/<name>`。它不会读取、写入或生成源码里的 `skill.json`。需要退回原安装状态时：

```bash
esl unlink @local/my-skill
```

有 staging 时 `unlink` 纯本地恢复原副本、依赖、锁文件和安装记录；无 staging 时移除 link 和记录。`uninstall` 链接技能时会保留本地源码目录。

### 6. 查看已安装技能 (List)
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

### 7. 手动同步 Tool Link (Adapt)
按当前工具配置检查并建立已安装技能的 Tool Link：
```bash
# 检查并建立当前项目的 Tool Link
esl adapt

# 检查并建立全局 Tool Link
esl adapt --global
```

### 8. 查看与删除 Tool Link
```bash
# 查看当前项目所有工具、技能和 link 状态
esl tools list

# 筛选工具、技能、作用域和状态
esl tools list --tool claude-code,codex --status broken,conflict
esl tools list --global --unmanaged
esl tools list --json

# 只解除指定工具的 link，保留 Skill Store 源
esl tools remove @cnfox/code-review --tools claude-code,cursor
```

### 9. 更新技能 (Update)
检查并升级已安装的技能到 ESL Server 上的最新版本。Skill Source Link 会保持源码实时状态并被跳过：
```bash
# 更新项目下所有技能
esl update

# 更新指定的某个技能
esl update @cnfox/code-review

# 更新全局技能
esl update --global

# 更新后确保指定工具存在正确 link
esl update @cnfox/code-review --tools claude-code,codex
```

### 10. 卸载技能 (Uninstall)
移除已安装的技能（清理 Skill Store 源、依赖/锁/安装记录及该技能的全部 ESL 管理 link）：
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
把当前源码发布为 Skill Release 到 ESL Server。版本号取自 `release.json`，不是命令参数：
```bash
cd my-skill
esl publish

# 指定版本说明（作为发布说明与 release tag 说明）
esl publish --message "fix: dead-link regex; feat: docx batch"

# 预演：跑完所有本地校验并展示将要发布的内容，不接触服务端
esl publish --dry-run

# 跳过交互确认（脚本 / 非交互）
esl publish --force
```
> 版本号来自被发布 commit 的 `release.json.version`；发布前请先 `esl version`（见下节）。直接传版本号（`esl publish 1.0.0`）会被拒绝并提示改用 `esl version`。
> 对一个已托管源，`publish` 会自动 `fetch`、必要时 rebase 到服务器最新、并 push 本地领先的提交——忘记 push 不再阻断发布；冲突时保留 rebase 现场，解决后重跑即可。
> 不传 `--message` 时，`publish` 自动收集"自上一个 release tag 以来的 commit 说明"作为版本说明；交互模式会展示让你确认/修改，直接回车即用默认。版本说明存入 release 记录（API 可查，供消费者判断是否升级）与 release tag。发布后如需修订说明：

```bash
esl notes @platform-ai/reviewer 1.1.0 --message "修订后的版本说明"
```
> **注意**：名称为 `@local/*` 的技能将被系统拦截，无法直接发布；发布身份（scope 即其 Namespace）由 Platform Organization 锁定，不能从登录用户推断。
> `publish` 要求目录含 `release.json`；缺失时自动补最小清单（`schemaVersion: 2`、`version: 0.1.0`）并落盘，随后提示先 `esl version` 设定版本、再发布。首次登记仍归 `esl upload`：尚无 `esl` remote 时 `publish` 会报错并提示先 `esl upload`，不会隐式建仓。
> 发布不可变、不可覆盖，错发只能靠弃用或删除补救。新版本低于服务器最高已发布版本时会被拒绝（防止手滑烧号）；确需回迁旧线时用 `--force` 越过。
> `esl publish` 发布前会要求确认；使用 `--force`（`-f`）可跳过确认，或配合全局 `--no-input` 在自动化中失败即止。

**弃用单个版本**：坏版本（安全缺陷、内容错误）发出后无法覆盖，可用弃用标记劝退消费者：
```bash
# 标记为不推荐：安装该版本时会看到这段说明，但仍可安装
esl deprecate @platform-ai/reviewer 1.0.0 --message "Use 1.1.0; this release ships a broken regex"

# 传空 message 解除标记
esl deprecate @platform-ai/reviewer 1.0.0 --message ""

# 内容必须从服务器消失时（例如误发密钥）：删除单个版本，需回显版本号确认
esl release-delete @platform-ai/reviewer 1.0.0 --confirm 1.0.0
```
> 弃用不改变版本解析：被弃用的版本若仍是最高稳定版，默认安装依旧会选中它（只是伴随警告）。
> `release-delete` 移除该版本的发布包、版本记录与 Release Tag，保留源码 Git 历史、技能本身与其他版本；**版本号烧毁、不可重发**，所以要求 `--confirm` 回显。技能 Maintainer 可删自己技能的版本；被其他技能的依赖锁定引用时服务端会拒绝并列出引用方，只有平台管理员能加 `--force` 强制（强制后依赖它的技能安装会失败）。
> 管理后台的技能管理页面「发布历史」里也有同样的删除入口（需回显版本号确认），Web 与 CLI 走同一个接口。

### 整技能生命周期：Archive / Restore / Delete

整技能 Archive、Restore 和彻底 Delete 只在 Web 的「技能管理 → 生命周期」区域提供；CLI 不提供 `esl delete`。

- **Archive**：持有该技能 `manage` 权限的人可停用技能。归档后不能修改源码或发布新版本。
- **Restore**：Archive 的逆操作。从未发布技能恢复为未发布；曾发布技能（包括只留下已删除 Release tombstone 的技能）恢复为已发布。权限与 Delete 相同。
- **Delete**：必须先 Archive。从未发布技能可由 `manage` 权限持有者删除；曾发布组织技能由平台管理员或组织 Owners 成员删除；曾发布个人技能由平台管理员或技能 owner / 创建者删除。组织管理成员和普通 `manage` 授权者不能删除已发布整技能。

Delete 前页面会展示将被移除的 Release 数和完整依赖方列表。依赖方不会阻断删除，但删除后这些依赖方可能安装失败。提交时必须填写非空原因，并输入完整技能身份（如 `@acme/code-review`）。删除成功后审计独立保存；完整 Skill Identity 名字释放，同名可重新登记为新 Skill 并生成新的 Skill ID。

如果 Git 仓库或发布包清理失败，技能会显示「删除失败」和错误原因；修复后可在同一入口重试。

### 5. 升级版本号 (Version)
源码形态（`SKILL.md` + `release.json`）的版本号存在 `release.json` 的 `version` 字段里，随源码走 Git 历史：
```bash
# 交互式选择：当前版本会算出 patch / minor / major 的目标值
esl version

# 递增：改写 release.json + 自动 commit + 打 annotated tag v<SemVer>（不 push）
esl version patch   # 0.1.0 -> 0.1.1
esl version minor   # 0.1.1 -> 0.2.0
esl version major   # 0.2.0 -> 1.0.0

# 显式设值（旧 schemaVersion: 1 清单的迁移入口）
esl version 1.4.2
```
> 裸 `esl version` 仅在交互式终端中显示选择器；非 TTY 或 `--no-input` 下必须显式传版本，避免脚本意外创建 commit 和 tag。AI Agent 可加 `--agent-interaction`，通过返回的版本选择问题收集答案后，用 `--params-json '{"release":"patch"}'` 重执行。
> `esl version` 不 push：推送归 `esl upload` 或下一次 `esl publish`（`publish` 会自动同步）。
> 工作树有未提交改动时 `version` 会拒绝执行，避免把无关改动卷进版本提交。
> 旧清单（`schemaVersion: 1`，无 `version` 字段）只提供自定义 SemVer 入口；显式设值完成迁移后，后续才能使用递增关键字。已有的历史 Skill Release 不受影响。

### 6. 克隆远端源码进行二次开发 (Source)
若需要对别人发布的技能进行二次开发或修复 Bug，可直接获取其完整 Git 源码：
```bash
# 将 @cnfox/code-review 的 Git 源码克隆到当前目录
esl source @cnfox/code-review

# 克隆到指定目录
esl source @cnfox/code-review ./custom-dir
```

---

## 六、 多 Agent 工具配置与目录映射 (Tool Link Reference)

当运行 `esl adapt` 或 `esl install` 时，系统按配置在对应 AI Agent 工作区中建立单技能目录 link，目标是 `.eslib/skills/@scope/skill-name` 源目录。Windows 使用 directory junction，类 Unix 使用目录 symlink；link 创建失败不会回退为复制。

| 工具名称 (`tools`) | 项目级安装路径 (Project) | 全局安装路径 (Global) |
| :--- | :--- | :--- |
| `claude`（输入别名 `claude-code`） | `<project>/.claude/skills/<skill-name>/` | `~/.claude/skills/<skill-name>/` |
| `codex` | `<project>/.codex/skills/<skill-name>/` | `~/.codex/skills/<skill-name>/` |
| `cursor` | `<project>/.cursor/skills/<skill-name>/` | `~/.cursor/skills/<skill-name>/` |
| `trae-intl` | `<project>/.trae/skills/<skill-name>/` | `~/.trae/skills/<skill-name>/` |
| `trae-cn` | `<project>/.trae/skills/<skill-name>/` | `~/.trae-cn/skills/<skill-name>/` |
| `workbuddy` | `<project>/.workbuddy/skills/<skill-name>/` | `~/.workbuddy/skills/<skill-name>/` |
| `opencode` | `<project>/.opencode/skills/<skill-name>/` | `~/.config/opencode/skills/<skill-name>/` |
| `openclaw` | `<project>/skills/<skill-name>/` | `~/.openclaw/skills/<skill-name>/` |
| `hermes` | `<project>/.hermes/skills/<skill-name>/` | `~/.hermes/skills/<skill-name>/` |

`claude-code` 是 Claude Code 的推荐输入别名，解析时会归一化为兼容标识
`claude`；已有配置和工具 link 不需要迁移。

你可以通过修改项目下的 `.skills.json` 文件来自定义当前项目需要适配的工具列表：
```json
{
  "skills": {
    "@cnfox/code-review": "^1.0.0"
  },
  "tools": ["claude-code", "trae-intl", "codex"]
}
```
