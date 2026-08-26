# 01 — Source Manifest 与源码契约

**What to build:** Skill User 可以首次创建 Server-hosted Skill Source，并通过 Git 管理源码和 `release.json`；服务器能够识别 Skill Identity、执行源码契约校验并建立协作权限。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Bootstrap 配置唯一且不可通过普通产品入口修改的 Platform Organization。
- [ ] `upload` 生成稳定的 `sk_` 前缀 Skill ID，创建组织内 Git 源码仓库，并登记 `@platform-organization/skill-name` Skill Identity。
- [ ] 源码只要求 `SKILL.md` 和 Git 管理的 `release.json`，不要求源码维护 `skill.json`。
- [ ] `SKILL.md.name` 保持短名，并与服务器登记的当前 Skill Identity 短名一致。
- [ ] `release.json` 必须包含 `schemaVersion`、`license`、`keywords`、`compatibility` 和 `dependencies`；除 `license` 外的集合字段可以为空但必须存在。
- [ ] `license` 接受有效 SPDX 表达式或平台定义的 `LicenseRef-*`。
- [ ] `upload` 只创建新 Source，不覆盖已有服务器源码；上传者成为初始 Maintainer。
- [ ] `source` 可按 Skill Identity 或 Skill ID 下载未发布源码；未发布源码不能 `install`，也不进入默认搜索。
- [ ] 只有 Maintainer 可以 push；普通 Git push 修改 `SKILL.md.name` 时被拒绝并提示使用 rename 流程。
