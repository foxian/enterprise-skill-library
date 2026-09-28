# 发布 ESL CLI（`@foxian/esl`）

本指南描述维护者将 ESL CLI 发行包发布到 npm，并创建同版本 GitHub Release 的
**人工**流程。决策背景见 [ADR-0052](../adr/0052-public-single-package-foxian-esl.md)
与 [ADR-0008](../adr/0008-client-coupled-built-in-skills.md)。

## 前置条件

- npm 账号 `foxian` 已登录（`npm whoami` → `foxian`），已启用 2FA，能向
  `@foxian/*` 发布 public 包。
- 本机可访问 GitHub 仓库 `foxian/enterprise-skill-library`（`gh auth status` 正常）。
- 工作区干净：待发布版本的代码已合并，`CHANGELOG.md` 已写好该版本说明。
- 已完成单包捆绑构建相关改动（包名 `@foxian/esl`、`postinstall` 位于 `dist/`、
  发布依赖不含 `@esl/*`）。

## 发布步骤

1. **对齐版本**  
   `packages/cli/package.json`（即 `@foxian/esl`）的 `version` 与
   `CHANGELOG.md` 对应章节、拟创建的 git tag `v<version>` 一致。内置技能
   `@builtin/esl-operator` 的版本必须等于该 SemVer（含 prerelease）。

2. **构建与测试**  
   在仓库根目录执行：
   - `npm test`
   - `npm run build`  
   确认 CLI workspace 构建产出含 `dist/bin/esl.js`、`dist/builtin/`、
   `dist/postinstall.js`（或约定的 postinstall 构建产物名）。

3. **打包自检（不上传）**  
   ```bash
   npm pack --workspace @foxian/esl --dry-run
   ```
   或实际 `npm pack --workspace @foxian/esl` 后检查 tarball：
   - 含 `dist/postinstall.*` 与 builtin 产物
   - `package.json` 的 `name` 为 `@foxian/esl`，`license` 为 `MIT`
   - 含面向用户的英文 `README.md`（npm 包页会展示；中文说明见仓库 `docs/guides/cli-package-readme.zh-CN.md`，不打进 tarball）
   - `dependencies` 中**没有** `@esl/core` / `@esl/i18n` 等未发布 workspace 包
   - `prepack` / 校验脚本确认 builtin 版本与包版本一致

4. **发布到 npm**  
   ```bash
   npm publish --workspace @foxian/esl --access public
   ```
   首次发布该 scope 包时必须带 `--access public`。

5. **打 tag 与 GitHub Release**  
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   gh release create v0.1.0 --title "v0.1.0" --notes-file - < CHANGELOG 中对应段落
   ```
   将 `v0.1.0` 换成实际版本；Release notes 使用 `CHANGELOG.md` 中该版本正文。

6. **冒烟**  
   在干净环境：
   ```bash
   npm i -g @foxian/esl@0.1.0
   esl --version
   ```
   确认命令可用；按需验证已安装全局 builtin 时 upgrade/postinstall 同步行为。

## 失败与注意

- **版本已存在**：npm 与 ESL 技能发布一样，同一版本不可覆盖；应 bump 后再发。
- **postinstall 失败**：不得阻断安装（ADR-0008）；若同步异常，检查 tarball 是否
  包含 `dist/postinstall.*` 及 `dist/commands/sync-builtin.js`。
- **不要**把 npm classic token 长期写入仓库或非必要 CI secret；当前流程为
  交互式 `npm login`。若改为 CI 发版，另开决策评估 Trusted Publishing。
- Client-coupled 技能文案（`skills/esl-operator/`）中的安装包名必须是
  `@foxian/esl`，与本发行面锁步。


