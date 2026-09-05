# 登录与环境准备

## 配置 Server 地址（一次性）
`esl config set-server <url>` —— 设 ESL Server 地址。本地 Docker 默认 `http://localhost:3000`。设一次后所有命令都用它，不必每次带 `--server`。

## 查看登录状态
`esl whoami` —— 输出当前用户名 / 所属组织 / 角色 / Server / 登录时间 / 过期时间 / 状态（`active` / `expired` / `Not logged in`）。只读，可直接跑。状态不明时先跑它。

## 登录
`esl login` —— 交互式（推荐）：依次提示 `Organization:`、`Username:` 与隐藏的密码（**组织必填**）。登录成功后 token 写入本机所有者只读文件，默认 30 天有效；可用环境变量 `ESL_LOGIN_TTL_HOURS`（单位：小时）调整 TTL。

旗标：
- `--org <orgname>`：所属组织（**必填**）。ESL CLI 只服务组织内成员，组织账号由服务端解析为 `<orgname>_<username>` 并校验归属；组织管理员用户名为 `admin`
- `--username <name>`：指定用户名（仍会交互提示密码）
- `--server <url>`：本次覆盖已配置地址（也可用环境变量 `ESL_SERVER`）
- `--token-file <path>`：用用户 token 文件登录（同样需要 `--org`）
- `--password-file <path>`：用密码文件登录（脚本 / CI）

平台管理员不通过 CLI 登录——打开管理后台（`http://<server>/admin/`），用 `GITEA_ADMIN_USERNAME` 账号（默认 `eslroot`）与密码登录。

## 登出
`esl logout` —— 清除本机凭据（token 与登录时间戳），保留 server / 组织 / 工具配置。幂等：未登录时执行也成功。登出后 `esl whoami` 显示 `Not logged in`，需要登录态的命令（install/update/upload 等）会提示先 `esl login`；离线命令（`adapt`/`list`/`validate`）与已安装技能的本地使用不受影响。用户想在共享机器上清除凭据、或要换一个组织账号登录时，提议它。写命令，先回显再执行。

## AI 行为（重要）
- **交互式密码登录让用户自己跑**：`esl login` 会在它自己的终端提示输入密码，你替它跑反而会卡住或把密码暴露给会话。引导用户在自己的终端执行。
- 可以由你执行的登录形式：用户已把凭据备成文件——`esl login --username X --token-file ./f` 或 `--password-file ./f`。凭据从文件读、不进命令行，安全。执行前按写命令规则先回显、等用户确认。
- 绝不在命令行里写明文密码或 token；CLI 本身也不接受命令行明文凭据。

## Token 过期
`whoami` 显示 `expired`，或某条命令报 401 → 让用户重新 `esl login`；可提一句 `ESL_LOGIN_TTL_HOURS` 调 TTL。
