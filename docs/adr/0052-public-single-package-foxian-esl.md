# 公开单包 `@foxian/esl` 作为 ESL CLI 发行面

Status: accepted

ESL 客户端要以 npm 公开发布，且维护者账号 / npm Scope 为 `foxian`。仓库虽是
`@esl/*` workspace monorepo，但对外不把 `@esl/core`、`@esl/i18n` 做成可安装的
公共库契约。决定：**唯一公开的 ESL CLI 发行包为 `@foxian/esl`**（MIT、public、
首发 `0.1.0`）；在构建期把运行所需的 `@esl/core` / `@esl/i18n` 以 vendor 拷贝进
`dist/vendor` 并重写发行包内 import，发布后的 `package.json` 不得再依赖
registry 上不存在的 `@esl/*`。workspace 内
仅将原 `@esl/cli` 包改名为 `@foxian/esl`；`@esl/core` 与 `@esl/i18n` 标为
`private`，server/web 本次不发布。

发行包不内置默认 ESL Server URL；Server 仍由用户配置、登录参数或 `ESL_SERVER`
提供。Node `engines` 继续遵循 ADR-0051。`postinstall`（全局内置技能同步，见
ADR-0008）必须作为构建产物进入 `dist/`，不能只靠源码树里的 `scripts/`——否则
在 `files: ["dist/"]` 下 npm 安装后 lifecycle 找不到脚本。

发布操作为维护者本机人工流程：`npm login` 后 `npm publish --access public`，
同版本再创建 GitHub Release；变更说明维护在 `CHANGELOG.md`，手发步骤落在
`docs/guides/publishing-cli.md`。暂不采用 CI 自动 publish，也不长期存放
classic npm token；若日后改为 CI 发版，再评估 npm Trusted Publishing（OIDC）。

## Considered Options

- **公开发布 `@foxian/cli` + `@foxian/core` + `@foxian/i18n` 多包**：给尚未承诺
  的库 API 增加版本与 breaking 面，弃。
- **继续用 `@esl/*` 作为 npm 包名 / 另建 `esl` npm org**：与已选个人 Scope
  `@foxian` 及安装名 `@foxian/esl` 目标不符，弃。
- **内部保留 `@esl/cli` 名称、另做「发布专用」包目录**：双轨身份长期成本高，弃。
- **写死默认生产 Server URL**：把可自建的 CLI 绑到单一部署，弃。

## Consequences

- 消费者安装面固定为 `npm i -g @foxian/esl`；Client-coupled 文档与 ADR-0008
  中的发行包名必须与此锁步，不得再指引 `@esl/cli`。
- npm Scope `@foxian` 与 ESL Namespace `@foxian` 同形不同实体，术语以
  `CONTEXT.md` 为准。
- 首次公开发布前还需具备：根目录 MIT `LICENSE`、package 元数据、捆绑构建、
  `npm pack` 自检（含 postinstall 与 builtin 版本对齐）。
