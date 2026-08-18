# 03 — 管理员重置/恢复任意用户密码

**What to build:** `esl admin user set-password <username>` 让平台管理员设置或重置任意 Skill User 的密码。默认生成随机密码并只显示一次交给管理员转达；也可用 `--password-file` 指定自定义密码。该命令同时承担忘记密码的恢复路径，以及把旧随机-UUID 行为创建的存量用户迁移到可用密码登录。调用新的服务端端点，要求平台管理员 token，复用现有 Gitea 改密通道。

**Blocked by:** 01 — 复用 T1 建立的密码供应规则与"只显示一次"模式

**Status:** ready-for-agent

- [ ] `esl admin user set-password <username>` 默认生成随机新密码，成功后终端只显示一次
- [ ] `--password-file <path>` 时使用文件密码，不显示随机密码；`--random` 与 `--password-file` 互斥
- [ ] 新密码被应用到该用户自己的 Gitea 账号
- [ ] 被重置的用户随后能用新密码通过 `esl login` 登录（旧密码不再有效）
- [ ] 存量用户（旧随机-UUID 密码）经此命令重置后可正常登录
- [ ] 未授权调用者（非平台管理员 token）无法重置任何用户密码
- [ ] 普通 Skill User token 无法重置其他用户密码
- [ ] 密码在 ESL 侧不被持久化，只转发给 Gitea
- [ ] CLI 命令测试验证密码供应规则、请求与输出（mock fetch）
- [ ] Server 路由测试验证 `POST /api/admin/users/:username/password` 的鉴权、随机/自定义密码路径
- [ ] GiteaService 测试验证改密请求体与端点
