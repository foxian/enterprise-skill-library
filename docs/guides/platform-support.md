# 平台支持矩阵

本文是 ESL 平台支持承诺的权威落位表（ADR-0053）。矩阵之外的平台不承诺——
能运行不代表支持。

## 档位定义

- **T1 承诺级**：该平台进 CI 矩阵，每次提交跑测试，破坏即阻断合并。
- **T2 验证级**：不进常规 CI，但每个发布前按成文检查单人工冒烟验证。
- **T3 尽力级**：消除已知平台假设，但不承诺验证节奏，用户报告问题再修。

## 落位表

| 端 | 平台 | 档位 | 形态 |
|---|---|---|---|
| ESL CLI | Windows | T1 | `@foxian/esl` 纯 npm 包（PowerShell / CMD） |
| ESL CLI | macOS | T1 | 同上（bash / zsh） |
| ESL CLI | Linux | T1 | 同上 |
| ESL Server | Linux | T1 | Docker Compose 栈（生产基线见 ADR-0047） |
| ESL Server | Windows | T2 | **仅 Docker Desktop 形态**；无原生 Node 部署 |
| ESL Server | macOS | 不承诺 | 不检测不阻止，不测试不文档化 |

## 前置条件

**ESL CLI（终端用户）**

- Node.js 20.17+ / 22.13+ / 23.5+ / 24.x（Node 25/26 不支持，ADR-0051）
- git 在 PATH 中（Windows 即 [Git for Windows](https://git-scm.com/download/win)）——
  install/use/upload/publish/source/status/init/version 等命令启动时会探测，
  缺失时给出安装指引
- 安装方式：`npm install -g @foxian/esl`

**ESL Server / 完整仓库开发**

- Node.js 22+（推荐 24）
- Docker 与 Docker Compose
- git

服务端在 Windows 上只有 Docker Desktop 一种支持形态，冒烟流程见
[Server Windows 冒烟 runbook](server-windows-smoke.md)。

## Windows 已知差异（CLI）

- **链接**：Tool Link 与 Skill Source Link 使用 directory junction（无需
  管理员权限或开发者模式）；类 Unix 使用目录 symlink。创建失败不会回退为
  复制，而是显式报错（ADR-0041、ADR-0042）。
- **凭据文件**：`credentials.json` 的 `0o600` 属主保护在 Windows 上无意义
  （NTFS 语义不同），凭据按用户 profile 目录的默认 ACL 保护。本轮不做
  DPAPI 等真加密。
- **安装副本只读**：`0o444` 只读方案经 Node chmod 映射为 Windows 的只读
  属性，基本可用。
- **路径比较**：Windows 上文件系统大小写不敏感，CLI 在比较路径时做大小写
  归一；盘符与 UNC 绝对路径均可识别。

## CI 覆盖

CI 矩阵（`.github/workflows/ci.yml`）即支持契约（ADR-0051、ADR-0053）：

- CLI job：ubuntu × Node 20.17 / 22 / 24 + windows-latest × Node 24 +
  macos-latest × Node 24；
- Server job：ubuntu × Node 22 / 24（容器内 OS 与宿主无关）。

e2e（Playwright）不在 CI 内，需 Docker Desktop 与系统 Chrome，三个桌面
平台均可本地运行。
