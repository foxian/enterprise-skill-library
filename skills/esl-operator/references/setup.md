# 登录与环境准备

## 配置 Server 地址（一次性）
`esl config set-server <url>` —— 设 ESL Server 地址。本地 Docker 默认 `http://localhost:3000`。设一次后所有命令都用它，不必每次带 `--server`。

## 查看登录状态
`esl whoami` —— 输出当前用户名 / Server / 登录时间 / 过期时间 / 状态（`active` / `expired` / `Not logged in`）。只读，可直接跑。状态不明时先跑它。

## 登录
`esl login` —— 交互式（推荐）：依次提示 `Username:` 与隐藏的密码。登录成功后 token 写入本机所有者只读文件，默认 30 天有效；可用环境变量 `ESL_LOGIN_TTL_HOURS`（单位：小时）调整 TTL。

旗标：
- `--username <name>`：指定用户名（仍会交互提示密码）
- `--org <orgname>`：指定所属组织；登录时把 Gitea 用户名组装为 `<orgname>_<username>`，组织信息随登录状态保存（`whoami` 会显示 `Organization`）。组织成员登录应带上它；交互式登录也会提示（可留空跳过）
- `--server <url>`：本次覆盖已配置地址
- `--token-file <path>`：用用户 token 文件登录（管理员签发）
- `--password-file <path>`：用密码文件登录（脚本 / CI）

管理员首次登录用 `ESL_BOOTSTRAP_ADMIN_TOKEN`：
```
esl login --username eslroot --token-file ./bootstrap-token.txt
```

## AI 行为（重要）
- **交互式密码登录让用户自己跑**：`esl login` 会在它自己的终端提示输入密码，你替它跑反而会卡住或把密码暴露给会话。引导用户在自己的终端执行。
- 可以由你执行的登录形式：用户已把凭据备成文件——`esl login --username X --token-file ./f` 或 `--password-file ./f`。凭据从文件读、不进命令行，安全。执行前按写命令规则先回显、等用户确认。
- 绝不在命令行里写明文密码或 token；CLI 本身也不接受命令行明文凭据。

## Token 过期
`whoami` 显示 `expired`，或某条命令报 401 → 让用户重新 `esl login`；可提一句 `ESL_LOGIN_TTL_HOURS` 调 TTL。
