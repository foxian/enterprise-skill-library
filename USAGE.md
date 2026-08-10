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
如需运行本地注册中心与 Gitea 服务，请在项目根目录执行：
```bash
docker compose up -d
```
详细说明请参阅 [DOCKER_SETUP.md](DOCKER_SETUP.md)。

### 2. 登录认证 (Login)
使用 CLI 登录内部技能服务网关：
```bash
esl login \
  --registry http://localhost:4001 \
  --git-base http://localhost:3001 \
  --username admin \
  --token your-gitea-token
```

---

## 三、 技能使用者指南 (Skill Consumer Workflow)

如果你是技能的使用者，希望在项目或个人开发环境中使用团队共享的技能：

### 1. 搜索技能 (Search)
在注册中心搜索可用技能：
```bash
esl search code-review
```

### 2. 查看技能详情 (Info)
查看指定技能的元数据、版本及 Git 仓库路径：
```bash
esl info @cnfox/code-review
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
# 从注册中心安装最新版本
esl install @cnfox/code-review

# 安装指定版本
esl install @cnfox/code-review --version 1.0.0

# 从本地相对路径安装（若缺少 skill.json，会自动隐式补全元数据并完成安装）
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
检查并升级已安装的技能到注册中心的最新版本：
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

## 四、 技能开发者指南 (Skill Author Workflow)

如果你是技能的开发者，希望创建、校验并发布新技能：

### 1. 初始化技能模板 (Init)
脚手架初始化一个新的技能目录：
```bash
# 在当前目录下创建 my-skill 文件夹
esl init my-skill --name @cnfox/my-skill
```
将会生成包含 `SKILL.md`（带 YAML Frontmatter）、`skill.json` 以及 `scripts/`、`references/`、`assets/` 等目录的标准规范包。

### 2. 校验技能规范 (Validate)
在发布前检查技能结构、`SKILL.md` 规范与 `skill.json` 元数据是否合法：
```bash
esl validate ./my-skill
```

### 3. 发布技能 (Publish)
将校验通过的技能推送到 Gitea 并在 Server 注册：
```bash
cd my-skill
esl publish
```
> **注意**：名称为 `@local/*` 的技能将被系统拦截，无法直接发布。请先在 `skill.json` 中配置合法的团队命名空间。

### 4. 升级版本号 (Version)
按照 SemVer 语义化版本更新技能版本：
```bash
esl version minor   # 0.1.0 -> 0.2.0
esl version patch   # 0.2.0 -> 0.2.1
esl version major   # 0.2.1 -> 1.0.0
```

### 5. 克隆远端源码进行二次开发 (Source)
若需要对别人发布的技能进行二次开发或修复 Bug，可直接获取其完整 Git 源码：
```bash
# 将 @cnfox/code-review 的 Git 源码克隆到当前目录
esl source @cnfox/code-review

# 克隆到指定目录
esl source @cnfox/code-review ./custom-dir
```

---

## 五、 多 Agent 工具配置与目录映射 (Multi-Agent Adaptation Reference)

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
