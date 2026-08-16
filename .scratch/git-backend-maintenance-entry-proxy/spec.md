Status: ready-for-agent

## Problem Statement

用户通过本地 Docker runtime 的 `ESL Server` 访问 `Git Backend Maintenance Entry`
时，页面主体可以进入或跳转，但 CSS、JavaScript、图片等静态资源返回 404，
导致维护入口样式缺失、交互不可用或页面显示不完整。

这个问题发生在 `Git Backend` 被挂载到 `ESL Server` 的 `/git` 路径下时。
外部访问路径需要保留 `/git`，但反向代理转发给 `Git Backend` 的上游请求不应把
这个外部前缀重复传给上游路由。当前行为违反了单一 `ESL Server` 入口的意图：
用户不应为了访问内部维护入口而改用单独的后端地址。

## Solution

保持 `ESL Server` 对外暴露的 `/git` 路径不变，让 `Git Backend Maintenance Entry`
继续通过同一个本地服务入口访问。同时调整本地 Docker runtime 的反向代理行为：
外部请求仍是 `/git/...`，但转发到 `Git Backend` 上游时去掉 `/git` 前缀，使上游收到
自己能够识别的登录页和静态资源路径。

修复后，用户访问 `Git Backend Maintenance Entry` 时，登录页和相关静态资源都应能
通过 `ESL Server` 正常加载。这个入口仍然是内部或恢复用途，不变成正常的 Skill User
产品界面。

## User Stories

1. As an ESL Platform Administrator, I want to open the Git Backend Maintenance Entry through the ESL Server, so that I can inspect the Git Backend without using a separate backend port.
2. As an ESL Platform Administrator, I want the Git Backend Maintenance Entry login page to render with its CSS, so that I can tell whether the page is usable.
3. As an ESL Platform Administrator, I want the Git Backend Maintenance Entry JavaScript assets to load through `/git`, so that page interactions work when maintenance is needed.
4. As an ESL Platform Administrator, I want image and icon assets to load through `/git`, so that the maintenance UI is visually complete.
5. As an ESL Platform Administrator, I want `/git` to remain the public path for Git HTTP and maintenance access, so that local runtime documentation and muscle memory stay consistent.
6. As a Skill User, I want normal CLI workflows to keep using the ESL Server, so that I do not need to understand the internal Git Backend topology.
7. As a Skill User, I want clone URLs discovered from the ESL Server to keep using the same `/git` route, so that Git operations continue to work after the maintenance UI fix.
8. As an operator, I want the reverse proxy to translate external `/git` paths into upstream paths correctly, so that the Git Backend does not receive duplicate route prefixes.
9. As an operator, I want the fix to preserve API routes under `/api`, so that Registry API behavior is not affected by the maintenance entry change.
10. As an operator, I want health checks to remain available through the ESL Server, so that local runtime readiness checks continue to work.
11. As a maintainer, I want the project glossary to name this surface as the Git Backend Maintenance Entry, so that future docs do not present it as a normal user portal.
12. As a maintainer, I want a high-level HTTP check for the regression, so that future proxy changes catch broken maintenance static assets.
13. As a maintainer, I want the fix to respect the accepted single user-facing server URL decision, so that the Git Backend remains an internal implementation detail.
14. As a maintainer, I want the change to be local to Docker runtime proxy behavior, so that production URL and HTTPS design can be handled separately.

## Implementation Decisions

- Preserve the existing `ESL Server` external contract: API routes live under `/api`, and Git HTTP plus `Git Backend Maintenance Entry` traffic live under `/git`.
- Keep `Git Backend` as an internal backend. The maintenance UI remains an internal or recovery path, not the normal Skill User product surface.
- Configure the local Docker reverse proxy so requests entering at `/git/...` are forwarded to the `Git Backend` without the external `/git` prefix.
- Do not change the `Registry API`, Skill User authentication, Skill User Token behavior, clone URL generation, or Bootstrap behavior as part of this fix.
- Do not expose a separate normal-use Git Backend URL. Debug-only direct exposure can remain a diagnostic path, but it is not the solution for this user-facing problem.
- Add or preserve domain language for `Git Backend Maintenance Entry` so future documentation can distinguish this maintenance surface from normal ESL workflows.
- Treat this as a local Docker runtime proxy correction, not as a broader production reverse-proxy or HTTPS configuration redesign.

## Testing Decisions

- The primary test seam is the highest user-visible seam: HTTP behavior through the running local Docker runtime's `ESL Server`.
- A good test checks external behavior, not the implementation details of the proxy config. It should prove that paths a user or browser requests through `/git` return usable responses.
- The regression check should request the `Git Backend Maintenance Entry` login page and representative static assets such as CSS, JavaScript, and image assets through `/git`.
- The expected signal is that the login page and representative assets return successful HTTP responses through `ESL Server`; static asset 404s indicate the bug is still present.
- Existing build and test commands remain part of verification to ensure the proxy fix does not break package-level TypeScript or the existing automated suite.
- The test should also preserve confidence that `/api` and health routes are outside the scope of the proxy-path change.
- If this becomes automated later, prefer a Compose-based smoke test or script that exercises the running service boundary instead of parsing the proxy file.

## Out of Scope

- Production reverse-proxy guidance for custom domains.
- HTTPS, TLS termination, certificate handling, or forwarded scheme hardening beyond the existing local runtime behavior.
- Changing the `Git Backend` implementation.
- Changing `Registry API` routes or response contracts.
- Changing Skill User login, token issuance, or Git authentication behavior.
- Reworking clone URL generation beyond preserving the existing `/git` external route.
- Making the `Git Backend Maintenance Entry` a normal product surface for Skill Users.
- Directly exposing the Git Backend as the recommended local workflow.

## Further Notes

- This work follows the accepted single user-facing server URL decision: normal clients use one `ESL Server` address, while internal backend topology stays hidden.
- The observed failure mode was static resources under `/git/assets/...` returning 404 because the upstream `Git Backend` received the external route prefix.
- The intended post-fix behavior is that `/git` stays visible externally while the upstream receives paths it can route internally.
- The current validated seam uses HTTP checks against the local Docker runtime plus the repository's standard `npm test` and `npm run build` verification commands.
