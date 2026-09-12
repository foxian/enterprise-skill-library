# 04 — 「最新版」改为解析最高稳定 SemVer

**What to build:** 默认安装解析不再依赖发布插入序——install / update / use 与服务端展示统一取「最高稳定 SemVer」，prerelease 版本仅在显式指定时可安装。这是 ADR-0030 相对现状改动面最大的一项。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] CLI `install`（`packages/cli/src/commands/install.ts:159` 的 `info.versions?.[0]`）、`update`（`update.ts:92`）、`use`（`use.ts:39`）改为按 SemVer 取最高稳定版。
- [ ] `update` 的「是否需要更新」判断由字符串不等改为 SemVer 比较，避免降级或误判。
- [ ] 解析默认排除 prerelease；prerelease 版本仅在显式 `--version` 时安装。
- [ ] 服务端公开信息接口的 `packageUrl`（`packages/server/src/routes/skills.ts:733`）改为基于最高稳定 Release。
- [ ] 管理后台 `buildSkillContext` 的 `latestRelease`（`skills.ts:908`）同步改为最高稳定 Release，避免 CLI 与后台显示不一致。
- [ ] Release Dependency Lock 解析（`skills.ts:761` 的 `releases.find(semver.satisfies)`）改为「满足 range 的最高版本」，仍排除 prerelease。
- [ ] 本地路径安装读源目录 `release.json.version`，移除硬编码 `0.1.0`（`install.ts:93`）。
- [ ] `esl info` 的版本列表按 SemVer 降序展示（不再依赖服务器插入序）。
- [ ] 测试与 E2E：发布顺序倒挂（先发 1.0.0 再发 0.9.0）时默认解析仍为 1.0.0；prerelease 不被默认命中；`packages/server/tests/app.test.ts:400-443` 的插入序断言按新规则更新。
