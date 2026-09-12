# 03 — `esl publish` 读取源码版本、自含源码同步、支持 dry-run

**What to build:** 发布不再接收版本参数——版本从被发布 commit 的 `release.json` 读出；对一个已托管源，`esl publish` 自动把本地领先的 commit 与 tag 推上去，忘 push 不再阻断发布。

**Blocked by:** 01、02

**Status:** ready-for-agent

- [ ] 移除 `publish [path] [version]` 的版本位置参数；传入版本时明确报错，指路 `esl version`。
- [ ] 版本取自 `HEAD` 的 `release.json.version`（不再由参数或服务器决定）。
- [ ] 已托管源（有 `esl` remote）发布前自动完成同步：`fetch` → 必要时 `rebase` → `push HEAD:main` 与 tag 上行；冲突处理沿用 `upload` 的既有逻辑（冲突时留下 rebase 现场并提示重跑）。
- [ ] 缺 `esl` remote 时报错指路先执行 `esl upload`——**首次登记不由 publish 隐式完成**：不建仓、不注册 Skill ID、不推断身份（ADR-0010 / ADR-0021）。
- [ ] 发布前校验 `v<SemVer>` tag 存在且指向被发布的 commit；缺失时由服务器补建（现有 `tagPending` / `repair-tag` 降级为兜底）。
- [ ] 新版本低于服务器最高已发布版本时警告并要求确认，`--force` 跳过（保留补丁回迁能力）。
- [ ] 新增 `--dry-run`：执行全部本地校验并打印待发布内容（版本、commit、文件清单），不产生任何服务端副作用。
- [ ] 保持既有确认语义：`--no-input` 未配 `--force` 时报错而非静默继续。
- [ ] 测试覆盖：无参数发布、传参数报错、缺 remote 报错、自动同步、低版本确认、dry-run 零副作用。
