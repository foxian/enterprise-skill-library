# 从零安装 ESL CLI 与 esl-operator（Windows / macOS / Ubuntu）

面向已经安装好 Codex、Claude Code 等 AI 工具的普通用户：从准备 Node.js/npm、安装 ESL CLI，到把内置 `esl-operator` 安装并链接到 AI 工具。

- **本指南的首要目标**：在 AI 工具中能够调用 `esl-operator`。完成这一步不需要 ESL Server、账号、登录、Git 或 Docker。
- **远端技能库操作**：首次需要访问远端技能库时，再按本指南配置 Server；需要私有访问或执行安装等操作时再登录。
- **不是这篇的范围**：安装 AI 工具、克隆本仓库、Docker 起 ESL Server、生产部署。那些请看 [本地开发指南](local-development.md) / [生产部署](production-deployment.md)。

npm 包页上的最短安装说明见 [`packages/cli/README.md`](../../packages/cli/README.md)；中文短说明见 [cli-package-readme.zh-CN.md](cli-package-readme.zh-CN.md)。

---

## 1. 你需要什么

| 层级 | 依赖 | 说明 |
| --- | --- | --- |
| 硬前置 | **Node.js** + **npm** | 官方支持 `20.17.x`、`22.x`（≥22.13）、`23.5.x`、`24.x`；**推荐 24.x**。npm 随 Node 安装。 |
| 硬前置 | **一个已安装的 AI 工具** | 例如 Codex 或 Claude Code；本指南会把 `esl-operator` 链接到你选择的工具。 |
| 远端使用时可选 | **ESL Server URL** | 未指定地址时默认使用公开云端 `https://cloud.enterprise-skills.com/`；自托管、企业私有实例或本地开发时，再按需覆盖。安装内置 `esl-operator` 不需要 Server。 |
| 此步骤不需要 | **账号、登录、Git、Docker** | 内置技能随 CLI 本地提供。访问受限的远端技能或执行远端写操作时，才按需注册/登录。 |

---

## 2. 装前环境检查

在终端执行（Windows 用 PowerShell 或「命令提示符」；macOS / Ubuntu 用系统终端）：

```bash
node -v
npm -v
```

期望：

- `node -v` 落在支持范围（推荐显示 `v24.x.x`）。
- `npm -v` 有版本号即可。

若 `node` / `npm` 不存在，按下一节安装 Node.js；npm 会随 Node.js 一起安装。安装并验证 ESL CLI、内置 `esl-operator` 不要求 Git。

---

## 3. 分平台安装 Node.js（每平台一条推荐路径）

装完后**新开一个终端**，再跑 `node -v` / `npm -v`，避免旧 `PATH` 未刷新。

### Windows

**推荐**：用 winget 安装 Node.js（当前 LTS 通道；装完以 `node -v` 为准，需落在 §1 支持范围，推荐 24）：

```powershell
winget install OpenJS.NodeJS.LTS
```

若公司机器没有 winget，或需要指定 24.x：打开 [https://nodejs.org](https://nodejs.org) ，下载并安装 **24.x** Windows 安装包（安装程序会附带 npm）。

### macOS

**推荐**：用 Homebrew 安装 Node 24：

```bash
brew install node@24
```

若 `brew` 提示需要把 `node@24` 链到 PATH，按它打印的 `brew link` / shell 配置说明操作，然后新开终端验证 `node -v`。

没有 Homebrew 时：打开 [https://nodejs.org](https://nodejs.org) ，安装 **24.x** macOS 包。

### Ubuntu

**推荐**：用 NodeSource 安装 Node.js 24.x：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

> 需要在同一台机器上维护多个 Node 版本时，可自行改用 nvm / fnm 等版本管理器；本指南默认不走那条路径，以减少决策。

---

## 4. 安装 ESL CLI

在终端运行：

```bash
npm install -g @foxian/esl
esl --version
```

`esl --version` 应打印版本号。安装 CLI 需要能访问 npm registry；这与 ESL Server 无关。

全局安装的 CLI 会每天最多检查一次 npm 上的稳定版本。发现新版时只提示，不会自动替换当前 CLI；运行 `esl self-update` 后仍需确认才会执行精确版本的 npm 安装。可用 `esl config set cli-update-check false` 关闭检查。项目级安装与 `npx` 不参与这套更新机制；需要固定版本时使用 `npx --yes @foxian/esl@<version>`。

更新检查状态复用 ESL 的用户级配置：Windows 为 `%USERPROFILE%\\.eslib\\config.json`，macOS/Linux 为 `~/.eslib/config.json`。不会在项目目录写入 CLI 更新状态。

### 装后检查清单

- [ ] `node -v` 和 `npm -v` 均能显示版本
- [ ] `esl --version` 能显示 ESL CLI 版本

到这里，ESL CLI 已可运行；下一步安装内置 `esl-operator`。

### 常见失败

| 现象 | 处理 |
| --- | --- |
| `esl: command not found` / 不是内部或外部命令 | 新开终端；确认 npm 全局 bin 目录在 `PATH` 中。Windows 可执行 `npm config get prefix`，把其下的目录加入用户 PATH 后重开终端。 |
| `EACCES` / 权限拒绝（常见于 macOS / Ubuntu 全局安装） | 不要随意 `sudo npm install -g` 作为长期方案。改用官方 Node 安装方式修好全局前缀权限，或按 npm 文档配置用户级 prefix；再重试 `npm install -g @foxian/esl`。 |
| 企业网络下 `npm` 拉包失败 | 见下方“常见安装问题：企业网络与全局路径”。 |

---

## 5. 安装并链接内置 esl-operator

选择你正在使用的 AI 工具运行对应命令。以下命令会把技能安装到个人全局 Skill Store，并创建对应的工具链接：

```bash
# Codex
esl skill install -g @builtin/esl-operator --tools codex

# Claude Code（二选一时，只运行与你的工具对应的命令）
esl skill install -g @builtin/esl-operator --tools claude-code
```

如果要同时接入这两个工具，用一条命令指定完整工具列表：

```bash
esl skill install -g @builtin/esl-operator --tools codex,claude-code
```

安装完成后，在 AI 工具中新开或刷新对话，并尝试输入：

> 请使用 esl-operator，帮我在 ESL 技能库里搜索一个代码审查技能。

如果 AI 工具尚未识别新技能，按该工具的说明刷新技能列表或重启工具。安装 `@builtin/esl-operator` 从当前 CLI 本地资源完成，不需要 ESL Server、账号、登录、Git 或 Docker。

---

## 6. 首次访问远端技能库时：配置 Server 与登录

本节不是安装 `esl-operator` 的前置条件。以后要搜索或查看公开云端的远端技能时，未指定地址会默认使用
`https://cloud.enterprise-skills.com/`；访问企业私有实例、自托管 Server 或本地开发 Server 时，再配置对应地址。
访问私有内容或执行远端安装、上传、发布等操作时，再按需登录。你也可以直接让 `esl-operator` 引导完成这些准备。

### 6.1 配置 ESL Server 地址（一次即可）

未指定 `--server`、环境变量 `ESL_SERVER` 或本地保存的地址时，CLI 默认使用公开云端：

```text
https://cloud.enterprise-skills.com/
```

如果你使用的是企业私有实例、自托管 Server 或本地开发 Server，请使用管理员提供的地址覆盖默认值：

```bash
esl config set-server https://your-esl-server.example
```

也可用环境变量 `ESL_SERVER`（适合 CI / 临时覆盖）。解析优先级是：命令行 `--server`、环境变量
`ESL_SERVER`、本地保存的地址、公开云端默认地址。

**本地 Docker 开发约定**（仅当你按 [本地开发指南](local-development.md) 在本机起了 Server 时）：常见地址是 `http://localhost:4070`。这不是公开发布 CLI 的出厂默认值。

### 6.2 最小注册路径（没有账号时）

1. 在浏览器打开：`{你的 Server 根地址}/admin/register-user`  
   例：`https://your-esl-server.example/admin/register-user`  
   本地 Docker：`http://localhost:4070/admin/register-user`
2. 按页面提示填写用户名、邮箱、密码并提交。
3. 视平台策略，可能需要**邮箱验证**，或进入**待管理员审批**；`open` 且无额外限制时可能注册即用。
4. 账号可用后，回到终端继续登录。

组织申请、审批后台、管理员代建号等**不在**本指南展开。平台管理员也不通过 CLI 登录（走管理后台）。

### 6.3 登录并校验

```bash
esl account login
esl account whoami
```

- `esl account login`：交互输入用户名与密码（**不要**把密码写在命令行里）。
- `esl account whoami`：应显示用户名、Server、状态 `active` 等。若为 `Not logged in` / `expired`，重新 `esl account login`。

到这里即视为**远端账号登录成功**。

更细的登录旗标、登出、Server 换址行为，见使用指南或内置技能说明；Agent 侧见随 CLI 发布的 `@builtin/esl-operator`（`references/setup.md`）。

---

## 7. 常见安装问题：企业网络与全局路径

- **HTTP(S) 代理**：若公司要求代理才能访问公网 npm，请按 IT 规范设置 `HTTP_PROXY` / `HTTPS_PROXY`，或 npm 的 `proxy` / `https-proxy`。
- **npm registry 镜像**：若官方 registry 不可达，按公司提供的镜像配置 `npm config set registry <url>` 后再 `npm install -g @foxian/esl`。
- **Windows 全局命令找不到**：确认「Node.js / npm 全局脚本目录」在用户 PATH 中；修改 PATH 后必须新开终端。
- **仍失败**：把 `node -v`、`npm -v`、`npm config get prefix`、完整报错发给管理员或维护者；不要反复更换随机安装渠道。

---

## 相关文档

- 英文包说明（npm）：[`packages/cli/README.md`](../../packages/cli/README.md)
- 中文短说明：[cli-package-readme.zh-CN.md](cli-package-readme.zh-CN.md)
- 使用指南：[usage.md](usage.md)
- 本地起 Server：[local-development.md](local-development.md)
- Node 支持策略：`docs/adr/0051-node-runtime-support.md`
- 单一公开 CLI 包：`docs/adr/0052-public-single-package-foxian-esl.md`
