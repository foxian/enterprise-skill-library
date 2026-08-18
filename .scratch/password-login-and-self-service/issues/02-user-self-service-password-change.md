# 02 — Skill User 自助修改自己密码

**What to build:** `esl account change-password` 让 Skill User 修改自己的登录密码。命令提示输入当前密码与新密码（新密码需二次确认），调用新的服务端端点；服务端先通过 Gitea 验证当前密码，再用管理员通道把新密码应用到用户自己的 Gitea 账号。改密成功后用户用新密码继续 `esl login` 登录，Git 操作凭证同步更新。现有 `esl admin account change-password` 行为保持不变。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] `esl account change-password` 提示当前密码、新密码、确认新密码（隐藏输入、确认一致）
- [ ] 当前密码错误时拒绝改密并给出清晰错误，不修改任何密码
- [ ] 当前密码正确时新密码被应用到该用户自己的 Gitea 账号
- [ ] 改密成功后用户用新密码可登录，旧密码不再有效
- [ ] 该端点要求有效 Skill User Token（未认证调用者被拒）
- [ ] 任意用户只能改自己的密码，不能影响其他用户
- [ ] 现有 `esl admin account change-password` 命令继续正常可用
- [ ] CLI 命令测试验证提示流程、发出的请求与错误路径（mock fetch）
- [ ] Server 路由测试验证 `POST /api/auth/password` 的鉴权、旧密码校验、成功路径
- [ ] GiteaService 测试验证登录验证与改密请求体
