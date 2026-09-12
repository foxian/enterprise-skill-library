# npm 式版本工作流 — 实现拆解

**Spec:** [ADR-0030](../../docs/adr/0030-semver-in-source-and-npm-style-release-workflow.md)（SemVer 进源码，发布链采用 npm 式版本工作流）

术语以 [CONTEXT.md](../../CONTEXT.md) 为准（Release Manifest、Deprecated Release、单版本删除）。

## 背景

ESL 此前「源码无版本」：SemVer 只作为 `esl publish` 的位置参数，「最新版」按插入序取
`releases[0]`，`esl version` 对源码格式技能直接拒绝。ADR-0030 把 SemVer 移入
`release.json`，并据此重构 `init` / `version` / `publish` 与版本解析规则。

## Issue 顺序与依赖

```
01 core: Release Manifest v2（version 必填）
 ├─ 02 esl version 重写 ──┐
 ├─ 07 esl init 交互问答   ├─ 03 esl publish 改形（依赖 01+02）
 ├─ 04 版本解析：最高稳定版
 ├─ 05 esl deprecate
 └─ 06 单版本删除
                            08 测试与文档收尾（依赖 01–07）
```

01 是所有后续项的前置；03 额外依赖 02（publish 读取 `esl version` 写入的版本与 tag）。
04 改动面最广（CLI 三命令 + 服务端两处 + 依赖锁定 + 本地安装），可与 02/03 并行。

## 迁移口径

旧 `schemaVersion: 1` 清单不做双轨兼容：`esl version <显式 SemVer>` 是唯一迁移入口，
bump 关键字在 `version` 缺失时报错指路。存量 Server-hosted Skill Source 需在其源码中
补写 `version` 并 push 后才能再次发布。
