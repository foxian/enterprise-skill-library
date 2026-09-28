# 平台支持矩阵：CLI 三平台与服务端分层承诺

Status: accepted

ADR-0051 把「支持」定义为文档 + `engines` + CI matrix，但那篇只覆盖了 Node
版本轴——本仓库的 CI（`.github/workflows/ci.yml`）此前只有 ubuntu runner，
支持契约里实际不存在 OS 轴。随着 Windows 用户出现，我们把平台支持升级为
显式的分层矩阵：CLI 三平台进 CI 承诺；服务端按部署形态分层，Windows 仅
Docker Desktop 形态，macOS 不承诺。

## 决策

- **三档定义**：
  - **T1 承诺级**：该平台进 CI 矩阵，每次提交跑测试，破坏即阻断合并；
  - **T2 验证级**：不进常规 CI，但每个发布前按成文检查单人工冒烟验证，文档明示；
  - **T3 尽力级**：消除已知平台假设，但不承诺验证节奏，用户报告问题再修。
- **CLI：Windows / macOS / Linux 均为 T1**。CLI job 矩阵：ubuntu 保留
  Node `20.17` / `22` / `24` 三轴（现状，零新增成本），windows-latest 与
  macos-latest 各加一个 Node `24` job。理由：平台特有的破坏几乎总来自
  OS 而非 Node 小版本，叉乘全矩阵（3 OS × 3 Node）成本不成比例。
- **CLI 分发形态不变**：纯 npm JS 包（`@foxian/esl`），不做平台独立二进制。
- **git 依赖**：CLI 要求 PATH 中有 git（Windows 即 Git for Windows）；相关
  命令启动时探测，缺失时给可行动错误（含安装指引）。不做自动安装。
- **链接策略不变**：维持 ADR-0041 / ADR-0042 的「Windows directory
  junction、类 Unix symlink、创建失败不回退复制」。
- **服务端：Linux 为 T1**（Docker Compose 栈，ADR-0047 的生产基线）。
- **服务端：Windows 为 T2，且仅 Docker Desktop 形态**。不做原生 Node 部署；
  每个发布前按成文冒烟 runbook 在 Windows 宿主上人工验证（GitHub 托管的
  Windows runner 跑不了 Linux 容器，无法自动化进 CI）。
- **服务端：macOS 不承诺**（T3 之下）：不做检测、不阻止运行，但不测试、
  不文档化、不写入支持矩阵。排除一个小众场景不值得工程动作。
- **Windows 已知差异文档化**：凭据文件的 `0o600` 保护在 Windows 无效
  （NTFS 语义不同），凭据按用户 profile 目录默认 ACL 保护，本轮不做
  DPAPI；安装副本的 `0o444` 只读方案经 Node chmod 到只读属性的映射，
  在 Windows 基本可用。
- **`esl-operator` 内置技能 shell 中立化**：去掉「用 bash 真跑」的前提，
  补 PowerShell 引号差异提示，与 CLI 三平台承诺保持一致（ADR-0008 的
  client-coupled 同步义务）。

## 考虑过的方案

- **CI 全叉乘（3 OS × 3 Node = 9 job）**：最严格，但 macOS runner 计费
  10×、Windows 2×，成本不成比例，拒绝。
- **三平台各只跑一个 Node**：比现状还省，但要砍掉 ubuntu 上 20.17/22 的
  既有验证，把 ADR-0051 的 Node 契约从「CI 验证」降为「仅声明」，拒绝。
- **服务端原生 Node on Windows**：历史设计稿
  （`docs/superpowers/specs/2026-07-28-gitea-migration-design.md` §8.3）
  曾规划过但从未落地；生产面已按 Linux + Docker 固化（ADR-0047），工程量
  与「前瞻性投资」的定位不匹配，拒绝。
- **服务端硬检测并拒绝在 macOS 运行**：为一个不承诺的场景增加代码与维护
  面，拒绝；改为「不承诺」。
- **CLI 打平台独立二进制**：构建/签名/分发面扩大数倍，与「消除平台假设
  而非扩大发布面」的目标冲突，拒绝。
- **Windows 凭据保护做 DPAPI**：真加密涉及凭据生命周期重设计，超出本轮，
  拒绝；差异文档化即可。

## 后果

- CI 新增 windows-latest 与 macos-latest 各一个 CLI job；runner 计费成本
  相应增加（2× 与 10×）。
- ADR-0051 的「支持 = CI matrix」契约由版本轴扩展为「版本轴 + OS 轴」；
  服务端 Windows 的 T2 是人工承诺，有效性依赖 runbook 的执行纪律。
- 服务端 Windows 用户拿到的支持形态是「Docker Desktop 能跑起来 + 发布前
  有人验证过」，而非原生部署路径；原生 Windows 服务端需求出现时需重开
  决策。
- 支持矩阵的当前落位（哪个平台哪一档）写入 `docs/` 平台支持文档与 README
  前置条件，不写入 `CONTEXT.md`；平台与版本数字同样不进 `CONTEXT.md`。
