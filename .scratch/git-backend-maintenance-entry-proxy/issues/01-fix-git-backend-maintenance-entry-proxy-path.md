# 01 — 修复 Git Backend Maintenance Entry 的 `/git` 反代路径

**What to build:** 本地 Docker runtime 中，用户继续通过 `ESL Server` 的 `/git`
访问 `Git Backend Maintenance Entry`，登录页和 CSS/JavaScript/图片静态资源不再因为
上游收到重复 `/git` 前缀而返回 404；`/api` 和健康检查路径保持不变。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 访问 `Git Backend Maintenance Entry` 时，外部路径仍使用 `ESL Server` 的 `/git`。
- [x] 代表性 CSS、JavaScript、图片静态资源通过 `/git` 返回成功响应。
- [x] `Registry API` 路由和健康检查路由没有因为反代调整而改变。
- [x] 变更符合单一 `ESL Server` 入口决策，未引入常规使用的独立 Git Backend 地址。

## Answer

本地 Docker runtime 的反向代理现在会保留外部 `/git` 入口，同时转发给
`Git Backend` 时去掉该外部前缀。真实 smoke 检查已通过 `ESL Server` 验证登录页和
代表性 CSS、JavaScript、图片资源返回成功响应。
