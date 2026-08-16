# 02 — 增加 Git Backend Maintenance Entry 的 Docker HTTP 回归检查

**What to build:** 一个可重复运行的本地 Docker runtime 行为检查，经由 `ESL Server`
请求 `Git Backend Maintenance Entry` 登录页和代表性静态资源，证明 `/git` 下的维护入口
资源返回成功响应，并保留标准测试和构建命令作为最终验证。

**Blocked by:** 01 — 修复 Git Backend Maintenance Entry 的 `/git` 反代路径.

**Status:** resolved

- [x] 回归检查通过 `ESL Server` 访问 `Git Backend Maintenance Entry`，而不是直接访问 Git Backend。
- [x] 回归检查覆盖登录页以及至少一类 CSS、JavaScript、图片静态资源。
- [x] 回归检查断言用户可见 HTTP 行为，不依赖解析反向代理配置文本。
- [x] 最终验证包含 `npm test` 和 `npm run build`。

## Answer

新增 `smoke:git-backend-maintenance-entry` 检查，通过 `ESL Server` 请求 `/health`、
`Registry API` 边界、`Git Backend Maintenance Entry` 登录页，以及登录页实际引用的
代表性 CSS、JavaScript、图片资源。新增 focused Vitest 覆盖请求路径、动态资源发现、
资源失败判定和缺少代表性资源时的失败行为。
