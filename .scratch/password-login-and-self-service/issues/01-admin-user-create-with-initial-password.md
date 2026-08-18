# 01 — 管理员创建用户时设置初始密码

**What to build:** `esl admin user create <username>` 让平台管理员创建 Skill User 时能为其设置初始密码。默认 ESL 生成一个随机初始密码并在终端**只显示一次**交给管理员转达用户；管理员也可用 `--password-file` 指定自定义密码。初始密码应用到用户对应的 Gitea 账号，之后该用户即可用用户名 + 密码通过 `esl login` 登录（无需领取 token）。随机生成时密码返回且仅返回一次，自定义时不生成密码。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] `esl admin user create <username>` 默认生成随机初始密码，创建成功后终端只显示一次该密码
- [ ] `--password-file <path>` 时使用文件中密码作为初始密码，不显示随机密码；两途径互斥
- [ ] 初始密码被应用到该用户的 Gitea 账号（不再是随机 UUID 的无人知晓密码）
- [ ] 该用户随后能用 `esl login` 以用户名 + 该密码成功登录
- [ ] 未授权调用者（非平台管理员 token）无法创建用户
- [ ] 密码在 ESL 侧不被持久化，只转发给 Gitea
- [ ] CLI 命令测试验证上述行为（mock fetch 断言发出的请求与输出）
- [ ] Server 路由测试验证 `POST /api/admin/users` 的密码生成/应用与鉴权失败
- [ ] GiteaService 测试验证创建用户请求体的 `password` 字段与端点
