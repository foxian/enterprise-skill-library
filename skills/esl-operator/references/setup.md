# 登录与环境准备

## 按任务准备环境

任务前置条件统一见本技能根目录下 `references/workflows.md` 的「环境按任务检查」；只处理当前任务缺失的条件。本页提供安装、配置和认证方法，不增加额外前置。

- 先运行 `esl --version`。CLI 缺失或启动失败时，再检查 `node --version` 与 `npm --version`。
- CLI 的 Node.js 支持范围与 `@foxian/esl` 的 engines 一致：`^20.17.0 || ^22.13.0 || ^23.5.0 || ^24.0.0`；推荐 24.x。缺 Node 或 npm 时不能安装 CLI。仓库开发的运行时要求另见仓库文档。
- Git 仅在源码或发布流程需要时检查，已发布包的 HTTP 安装无需本机 Git。
- 远端任务才要求配置 Server；需要鉴权时检查 `esl account whoami`，看到 `Not logged in` 不代表 CLI 安装失败。

CLI 安装成功的标准是 `esl --version` 有版本号；远端任务另检查 Server，需要鉴权时再确认 `whoami` 显示 `active`。本地任务无需为此配置 Server 或登录。普通消费者不需要 Docker。

## 环境问题的分流话术

- **没有 `esl`**：说明“CLI 尚未安装”，引导 `npm install -g @foxian/esl`，新开终端后复查 `esl --version`。
- **远端任务有 `esl` 但没有 Server**：说明“客户端已安装、服务端地址未配置”，向用户索取管理员给出的 URL，再确认后执行 `esl config set-server <url>`。
- **需要鉴权的远端任务有 Server 但未登录**：说明“环境已就绪但账号未认证”，让用户在自己的终端运行交互式 `esl login`，不要代输密码。
- **只想搜索公共技能**：可以先继续，不强制登录；涉及私有技能、安装、上传或发布时再处理认证。
- **Node/Git 不满足**：不要反复重试 ESL 命令，先修复对应前置并重新体检。

## CLI 尚未安装

若终端报 `esl: command not found`（或同类「无法执行 esl」），先回到 `SKILL.md` 的「命令找不到 / 服务不通」最短失败卡：检查 `node`/`npm` → `npm install -g @foxian/esl` → `esl --version`。人类分平台详版见 `docs/guides/cli-install.md`（https://github.com/foxian/enterprise-skill-library/blob/master/docs/guides/cli-install.md）。**不要**在未装上 CLI 时继续本页的 login / set-server 步骤。

## 配置 Server 地址（一次性）

## 语言偏好
登录响应会把账户的 `locale` 保存到本机 CLI 配置；后续命令默认按该语言输出。任意命令可用 `--locale zh-CN` 或 `--locale en-US` 做单次覆盖，但不会写回账户偏好。账户偏好本身在 Web 设置中管理。

`esl config set-server <url>` —— 设 ESL Server 地址。发行包**无**出厂默认 URL；使用部署者配置的实例地址，本地 Docker 开发常见 `http://localhost:4070`。设一次后所有命令都用它，不必每次带 `--server`。

## Server Origin 迁移（服务器换地址）
ESL Server 换域名/IP 且**数据整体迁移**（技能、版本、Release 原样保留）时，改完 `esl config set-server <新地址>` 后：

- **消费端自动跟随**：install/update/use/source clone 每次从服务器现取地址，无需额外操作。
- **已托管源目录自动重指**：之前 `esl source upload` 过的目录（带 `esl` remote）在下一次 `esl source upload` 时自动验证技能身份并把 remote 重指到新地址，输出一行「re-homed the esl remote」提示；`esl source status` 在这类目录只读提示 origin 漂移（ahead/behind 在重指前可能过期），不改任何配置。不需要也不建议手动 `git remote set-url`。
- **upload 报「地址迁移未验证」时**：报错说明 esl remote 指向旧地址而配置是新地址、但技能身份在当前服务器验证不过——先让用户确认当前登录账号能否读到该技能（换维护账号重登再 `esl source upload`）；只有确认服务器上确实没有该源时，才走手动 `git remote remove esl` + 重新 `esl source upload`（按新技能重建，历史 Release 不回来）。绝不主动提议删 remote。

## 查看登录状态
`esl account whoami`（快捷：`esl whoami`）—— 输出当前用户名 / Email / Organization memberships（组织成员关系列表）/ Server / 登录时间 / 过期时间 / 状态（`active` / `expired` / `Not logged in`）。默认只读，可直接跑。状态不明时先跑它。展示的是**登录时记录的快照**：邮箱在密码登录时从服务器取回并存在本机，之后在网页上改了邮箱需重新登录才会刷新；`--token-file` 离线登录不取邮箱，同一账号重登保留原有邮箱与组织列表，换账号重登则清空（不显示 Email 行）。

`--online` 旗标：向服务器核实账户资料（邮箱、组织隶属）并把结果写回本地快照，随后默认的离线 whoami 也反映最新值。它是**写命令**（更新本机配置），执行前按写命令规则先回显、等用户确认。用户改过邮箱/组织后想让本地立刻跟上，或只有 token 文件（无法用密码重登）时，提议它。未登录、服务器地址缺失、或请求失败（含 token 失效）时直接报错，不回退到本地旧值——避免把陈旧资料当成刚核实的结果。
（全局身份模型：一条凭据走遍个人命名空间与所有所在组织，组织列表由服务端按 Git Backend 成员关系派生。旧版配置带 `org`/`role` 字段时输出一行重新登录提示。）

## 登录
`esl account login`（快捷：`esl login`）—— 交互式（推荐）：依次提示 `Username:` 与隐藏的密码（**无组织输入**）。登录成功后 token 写入本机所有者只读文件，默认 30 天有效；可用环境变量 `ESL_LOGIN_TTL_HOURS`（单位：小时）调整 TTL。

旗标：
- `--username <name>`：指定用户名（仍会交互提示密码）
- `--server <url>`：本次覆盖已配置地址（也可用环境变量 `ESL_SERVER`）
- `--token-file <path>`：用用户 token 文件登录（离线，不换取身份；组织列表与邮箱不取新值，同一账号重登沿用本地已有值）
- `--password-file <path>`：用密码文件登录（脚本 / CI）

账号是全局的：注册后即拥有个人命名空间 `@用户名`，被拉入组织后同样一份凭据即可访问组织命名空间，无需按组织分别登录。平台管理员不通过 CLI 登录——打开管理后台（`http://<server>/admin/`），用 `GITEA_ADMIN_USERNAME` 账号（默认 `eslroot`）与密码登录。

## 登出
`esl account logout`（快捷：`esl logout`）—— 清除本机凭据（token 与登录时间戳），保留 server / 组织 / 工具配置。幂等：未登录时执行也成功。登出后 `esl account whoami` 显示 `Not logged in`，需要登录态的命令（install/update/source upload 等）会提示先 `esl account login`；离线命令（`list`/`source validate`）与已安装技能的本地使用不受影响。用户想在共享机器上清除凭据、或要换一个组织账号登录时，提议它。写命令，先回显再执行。

## AI 行为（重要）
- **交互式密码登录让用户自己跑**：`esl account login` 会在它自己的终端提示输入密码，你替它跑反而会卡住或把密码暴露给会话。引导用户在自己的终端执行。
- 可以由你执行的登录形式：用户已把凭据备成文件——`esl account login --username X --token-file ./f` 或 `--password-file ./f`。凭据从文件读、不进命令行，安全。执行前按写命令规则先回显、等用户确认。
- 绝不在命令行里写明文密码或 token；CLI 本身也不接受命令行明文凭据。

## Token 过期
`esl account whoami` 显示 `expired`，或某条命令报 401 → 让用户重新 `esl account login`；可提一句 `ESL_LOGIN_TTL_HOURS` 调 TTL。

跨实例播种与换 Server Origin 不同：`esl source export` 在本机产生无 Git 历史的独立副本，不自动修改当前 `esl config set-server`、登录信息或源目录 remote；目标企业再自行设置其 Server、确认 namespace 并首次上传。不要在源目录执行 `source reset` 或 `source clean` 来做分发；`source clean` 只用于明确要把当前目录去身份。
