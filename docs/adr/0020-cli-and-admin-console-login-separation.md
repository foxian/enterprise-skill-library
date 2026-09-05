# CLI 与管理后台登录面分离

Status: accepted

ESL CLI 只面向组织内成员（Organization Admin 与普通成员）；平台管理员（Super
Administrator）不通过 CLI 登录，只通过管理后台（Admin Console，`/admin/`）以
ESL Administrator Account 密码登录。为此把登录面按客户端拆开，并把
`<org>_<username>` 账号拼装收进服务端：

- `/api/auth/login`（CLI 专用）：组织必填，请求体为 `{ org, username, password }`。
  服务端拼装 Gitea 账号 `<org>_<username>`、校验该账号确属该组织后签发 token，
  响应 `{ token, username, org, role }`。平台管理员无组织，结构性无法通过此端点
  登录；`role`（`org-admin` / `member`）由服务端判定并返回，CLI 存入本地配置，
  `whoami` 展示。
- `/api/console/login`（管理后台专用）：三类角色都收。带组织的账号同样按
  `<org>_<username>` 解析并校验归属；不带组织的账号必须是平台管理员
  （`GITEA_ADMIN_USERNAME`），否则拒绝——防止遗留的无组织普通账号被当作超级
  管理员。角色由服务端返回，前端不再用命名约定自行推导。
- 退役 `ESL_BOOTSTRAP_ADMIN_TOKEN` 与 `AdminRepository.getPlatformAdminForToken`
  的静态 token 分支（原默认值为字面量 `bootstrap-token`）。平台管理员访问
  `/api/admin/*` 一律靠自己密码签发的 token，经
  `GiteaService.validateAdminUserToken` 校验。

## 背景

多租户组织模型（ADR-0016）落地后，账号体系收敛为「组织内成员」与「平台管理
员」两类；CLI 的远程管理命令族（`esl admin user/account ...`）已先行移除
（commit 58e5b6b），但 `esl login` 仍接受无组织登录，平台管理员可以
`esl login --username eslroot` 进入 CLI，与「管理员只在后台操作」的目标相悖。
同时登录契约把 `org_username` 拼装泄漏给客户端，`whoami` 也无法区分组织管理员
与普通成员。

## Consequences

- 登录 API 契约变更：`/api/auth/login` 请求体由 `{ username, password }` 变为
  `{ org, username, password }`，响应新增 `org`、`role`；新增 `/api/console/login`。
  旧 CLI 与旧前端需要同步升级，否则无法登录。
- `ESL_BOOTSTRAP_ADMIN_TOKEN` 从 `.env.example`、`docker-compose.yml` 与
  `ServerConfig` 中移除；`AdminRepository` 不再接收 bootstrap token。任何仍用
  `token bootstrap-token` 直连 `/api/admin/*` 的脚本失效，改为使用平台管理员
  密码登录后签发的 token。
- 管理后台补位：平台设置页新增「管理员账号改密」（`POST
  /api/admin/account/password`）；平台概览并入 bootstrap 状态条
  （`GET /api/admin/bootstrap/status`）；不新增平台用户管理页——用户由组织
  管理员在组织内创建（`/api/orgs/members`）。
- 无组织普通账号（旧 `esl admin user create` 产物）失去所有登录面：CLI 要求
  组织，管理后台仅接受平台管理员的无组织账号。冒烟/生命周期文档改为组织内
  成员流程。
- CLI 配置新增 `role` 字段；`esl login` 组织必填，交互顺序为
  Organization → Username → Password。
- 组织未激活（开通/失败/删除中/删除失败）的门禁同时覆盖两个登录端点，基于
  请求体 `org` 字段判断。
