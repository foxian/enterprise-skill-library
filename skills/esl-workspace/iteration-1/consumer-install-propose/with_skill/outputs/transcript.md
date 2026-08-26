# Transcript: 把 @esl-skills/demo-renamed 装到当前项目

## 任务
用户请求："把 @esl-skills/demo-renamed 装到当前项目"

## 环境
- 项目根：D:\DevProjects\enterprise-skill-library
- ESL CLI 已装、在 PATH 上，PowerShell 中以 `esl <command>` 运行
- ESL Server 运行于 http://localhost:3000，登录用户 `consumer`（状态 active）
- 遵循技能：D:\DevProjects\enterprise-skill-library\skills\esl\SKILL.md
- 自主模式：只读命令可直接执行；写命令只回显提议、不执行

## 推理过程

### 1. 路由意图
用户说"把 X 装到当前项目"——属于"装、安装"类。按 SKILL.md 的路由表，读 `references/consumer.md` 拿到 `install` 命令清单。

### 2. 分级判定
`esl install` 是写命令（会从远端拉内容进项目、会改 `.skills/`、会刷 AI 工具目录），按"三条不可妥协的规则"之规则 1，**先回显完整命令、等用户明确同意再跑**。自主模式下规则同样适用：提议并 STOP。

### 3. 装前只读核查（直接执行）
为了让提议有依据（确认已登录、确认目标技能存在），先跑两条只读命令：

#### 3.1 `esl whoami` —— 确认登录态
命令：
```powershell
esl whoami
```
输出：
```
Username: consumer
Server: http://localhost:3000
Logged in at: 2026-08-25T10:35:11.646Z
Expires at: 2026-09-24T10:35:11.646Z
Status: active
```
结论：已登录、状态 active、token 未过期。无需走 `references/setup.md`。

#### 3.2 `esl info @esl-skills/demo-renamed` —— 确认远端技能存在
命令：
```powershell
esl info @esl-skills/demo-renamed
```
输出：
```
Name: @esl-skills/demo-renamed
Description: Shared demo skill
Versions: 0.1.2, 0.1.1, 0.1.0
Repository: esl-skills/demo-renamed
```
结论：技能存在，最新版本 0.1.2。可用全名 `@esl-skills/demo-renamed` 引用（远端技能，符合规则 3 的身份语法）。

### 4. 构造 install 命令
依据 `references/consumer.md`：
```
esl install @ns/name|./path [--version V] [--global] [--no-adapt]
```
用户说"装到当前项目"——不用 `--global`（默认装到 `.skills/`）。
用户未指定版本——装最新 0.1.2（默认行为）。
用户未说不要刷到工具——保留默认自动 adapt。
故命令为：
```powershell
esl install @esl-skills/demo-renamed
```

### 5. 分级执行决定
`install` 是写命令——**提议并 STOP，不执行**。

## 提议的命令（未执行）
```powershell
esl install @esl-skills/demo-renamed
```
- 作用：从 ESL Server 拉取 `@esl-skills/demo-renamed` 最新版本（0.1.2）到当前项目 `.skills/`，并自动 adapt 到已配置的 AI 工具目录
- 未加 `--global`：装到当前项目而非全局
- 未加 `--version`：装最新版本
- 未加 `--no-adapt`：保留默认同步到 AI 工具目录的行为
- 等待用户明确同意后才执行

## 已执行命令汇总
| # | 命令 | 类型 | 结果 |
|---|---|---|---|
| 1 | `esl whoami` | 只读 | consumer，active，已登录 |
| 2 | `esl info @esl-skills/demo-renamed` | 只读 | 技能存在，最新 0.1.2 |

## 提议但未执行命令汇总
| # | 命令 | 类型 | 状态 |
|---|---|---|---|
| 1 | `esl install @esl-skills/demo-renamed` | 写 | 已提议，待用户确认 |

## 给用户的最终答复
确认已登录 `consumer`，且 `@esl-skills/demo-renamed` 存在（最新 0.1.2）。`install` 是写命令，按规则我只提议、不自行执行。请确认是否运行：

```
esl install @esl-skills/demo-renamed
```

（默认装到当前项目 `.skills/` 并自动 adapt 到已配置工具目录；如不要 adapt 加 `--no-adapt`，如装到全局加 `--global`。）
