# ESL CLI 安装指南（Windows / macOS / Ubuntu）

面向**终端用户**：本机还没有 `esl` 命令时，如何准备环境、安装 `@foxian/esl`，并完成首次登录校验。

- **成功标准**：`esl --version` 可用 → 已配置 ESL Server → `esl account login` → `esl account whoami` 显示已登录。
- **不是这篇的范围**：克隆本仓库、Docker 起 ESL Server、生产部署。那些请看 [本地开发指南](local-development.md) / [生产部署](production-deployment.md)。

npm 包页上的最短安装说明见 [`packages/cli/README.md`](../../packages/cli/README.md)；中文短说明见 [cli-package-readme.zh-CN.md](cli-package-readme.zh-CN.md)。

---

## 1. 你需要什么

| 层级 | 依赖 | 说明 |
| --- | --- | --- |
| 硬前置 | **Node.js** + **npm** | 官方支持 `20.17.x`、`22.x`（≥22.13）、`24.x`；**推荐 24**。npm 随 Node 安装。 |
| 硬前置 | **可访问的 ESL Server URL** | `@foxian/esl` **不内置**默认 Server 地址。向管理员索取公司部署地址，或使用自有实例。 |
| 强烈建议 | **Git**（在 `PATH` 中） | 装 CLI 与 `account whoami` **不需要** Git；但首次远端 `esl skill install` / `esl source upload` / `esl release publish` / `esl source clone` 等会调用本机 `git`。建议一并装好。 |
| 不需要 | Docker | 只消费已有 ESL Server 时不需要 Docker。 |

账号：需要一个 **Skill User** 账号才能 `esl account login`。没有账号时见下文「最小注册路径」。**CLI 不能替你注册。**

---

## 2. 装前环境检查

在终端执行（Windows 用 PowerShell 或「命令提示符」；macOS / Ubuntu 用系统终端）：

```bash
node -v
npm -v
git --version
```

期望：

- `node -v` 落在支持范围（推荐显示 `v24.x.x`）。
- `npm -v` 有版本号即可。
- `git --version` 有输出（若缺失，先装 Git，或接受稍后再装，见 §1）。

若 `node` / `npm` 不是内部或外部命令，按下一节为你的系统安装 Node。

---

## 3. 分平台安装 Node.js（每平台一条推荐路径）

装完后**新开一个终端**，再跑 `node -v` / `npm -v`，避免旧 `PATH` 未刷新。

### Windows

**推荐**：用 winget 安装 Node.js（当前 LTS 通道；装完以 `node -v` 为准，需落在 §1 支持范围，推荐 24）：

```powershell
winget install OpenJS.NodeJS.LTS
```

若公司机器没有 winget，或需要指定 24.x：打开 [https://nodejs.org](https://nodejs.org) ，下载并安装 **24.x** Windows 安装包（安装程序会附带 npm）。

**强烈建议同时安装 Git**：

```powershell
winget install Git.Git
```

或使用 [https://git-scm.com/download/win](https://git-scm.com/download/win)。

### macOS

**推荐**：用 Homebrew 安装 Node 24：

```bash
brew install node@24
```

若 `brew` 提示需要把 `node@24` 链到 PATH，按它打印的 `brew link` / shell 配置说明操作，然后新开终端验证 `node -v`。

没有 Homebrew 时：打开 [https://nodejs.org](https://nodejs.org) ，安装 **24.x** macOS 包。

**强烈建议同时安装 Git**（若 `git --version` 已可用可跳过）：

```bash
brew install git
```

或安装 Xcode Command Line Tools：`xcode-select --install`。

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

**强烈建议同时安装 Git**：

```bash
sudo apt-get install -y git
```

> 需要在同一台机器上维护多个 Node 版本时，可自行改用 nvm / fnm 等版本管理器；本指南默认不走那条路径，以减少决策。

---

## 4. 安装 ESL CLI

```bash
npm install -g @foxian/esl
esl --version
```

应打印与所装包一致的版本号（例如 `0.1.1`）。

### 装后检查清单

- [ ] `esl --version` 成功
- [ ] （建议）`git --version` 成功
- [ ] 已拿到 ESL Server URL（不是猜的；发行包**没有**出厂默认地址）

### 常见失败

| 现象 | 处理 |
| --- | --- |
| `esl: command not found` / 不是内部或外部命令 | 新开终端；确认 npm 全局 bin 目录在 `PATH` 中。Windows 可执行 `npm config get prefix`，把其下的目录加入用户 PATH 后重开终端。 |
| `EACCES` / 权限拒绝（常见于 macOS / Ubuntu 全局安装） | 不要随意 `sudo npm install -g` 作为长期方案。改用官方 Node 安装方式修好全局前缀权限，或按 npm 文档配置用户级 prefix；再重试 `npm install -g @foxian/esl`。 |
| 企业网络下 `npm` 拉包失败 | 见 §7 附录。 |

---

## 5. 配置 Server、注册（如需要）与登录

### 5.1 配置 ESL Server 地址（一次即可）

`@foxian/esl` **不内置**默认 ESL Server URL。请使用管理员提供的地址：

```bash
esl config set-server https://your-esl-server.example
```

也可用环境变量 `ESL_SERVER`（适合 CI / 临时覆盖）。

**本地 Docker 开发约定**（仅当你按 [本地开发指南](local-development.md) 在本机起了 Server 时）：常见地址是 `http://localhost:3000`。这不是公开发布 CLI 的出厂默认值。

### 5.2 最小注册路径（没有账号时）

1. 在浏览器打开：`{你的 Server 根地址}/admin/register-user`  
   例：`https://your-esl-server.example/admin/register-user`  
   本地 Docker：`http://localhost:3000/admin/register-user`
2. 按页面提示填写用户名、邮箱、密码并提交。
3. 视平台策略，可能需要**邮箱验证**，或进入**待管理员审批**；`open` 且无额外限制时可能注册即用。
4. 账号可用后，回到终端继续登录。

组织申请、审批后台、管理员代建号等**不在**本指南展开。平台管理员也不通过 CLI 登录（走管理后台）。

### 5.3 登录并校验

```bash
esl account login
esl account whoami
```

- `esl account login`：交互输入用户名与密码（**不要**把密码写在命令行里）。
- `esl account whoami`：应显示用户名、Server、状态 `active` 等。若为 `Not logged in` / `expired`，重新 `esl account login`。

到这里即视为**安装与首次登录成功**。

更细的登录旗标、登出、Server 换址行为，见使用指南或内置技能说明；Agent 侧见随 CLI 发布的 `@builtin/esl-operator`（`references/setup.md`）。

---

## 6. 推荐下一步（可选）

- 搜索 / 试用 / 安装技能：`esl skill search`、`esl skill use`、`esl skill install`（远端安装需要本机 **Git**）。
- 若希望 **AI Agent 驱动 `esl`**：首次需**显式**安装内置技能，例如  
  `esl skill install -g @builtin/esl-operator`  
  安装时用 `--tools` 指定要链接的 AI 工具（如 `--tools claude-code,codex`），或之后用 `esl link`（细节见 [usage.md](usage.md)）。  
  仅 `npm install -g @foxian/esl` **不会**自动把 operator 装进全局技能库（见 ADR-0008）。

---

## 7. 附录：企业网络与全局安装排障

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
