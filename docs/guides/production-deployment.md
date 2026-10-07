# 生产部署与运维手册

ESL 生产部署基线见 ADR-0047：单台 Linux 服务器 + Docker Compose，生产配置以
override 叠加在开发栈之上，开发/生产脚本按运行环境分目录。服务器唯一前置依赖：
**Docker 与 git**（无 node）。

域名、TLS 和公网入口都不是 ESL 产品的固定组成部分（ADR-0058 / ADR-0060）：
默认部署不绑定任何域名，用 `localhost` 或服务器 IP 即可直接访问；需要域名、
HTTPS 或把服务暴露到公网时，由部署者自行配置，实例配置不进入公开仓库。

## 核心概念对照

| 概念 | 开发环境 | 生产环境 |
|------|---------|---------|
| 运行配置 | `docker compose up` | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up`（下称「生产 compose 命令」） |
| 域名 | 默认 localhost，不绑定 | 默认不绑定，localhost / IP 直接可用；域名路由按需添加 |
| Git Backend 直连 | 宿主 3001 端口（E2E/调试） | 不暴露，仅经 `/git/` 反代（ADR-0004） |
| 前端 | 本机构建 dist 挂载 | 烤入 `server` 镜像（回滚 = 换回旧镜像） |
| 实例自定义路由 | 不挂载 | `nginx-conf.d/` 挂载到容器 `/etc/nginx/conf.d` |
| 种子数据 | `ESL_AUTO_SEED` 可开 | 恒 false，干净启动 |
| 「回到过去」 | `npm run reset:dev`（有生产护栏，见下） | **备份/恢复**（`scripts/prod/backup.sh` / `restore.sh`） |

## 首次部署（一次性）

```bash
# 1. 服务器只装 Docker + git，然后克隆仓库
git clone <repo> && cd enterprise-skill-library

# 2. 创建环境配置（不要提交 .env）
cp .env.example .env
vi .env          # 必填：GITEA_ADMIN_PASSWORD（强密码，同步存入密码管理器）
                 #      ESL_ENVIRONMENT=production
                 # ESL_SERVER_URL 默认 http://localhost:3000；
                 # 有域名或对外地址时改为对应值
chmod 600 .env   # .env 含秘密，仅文件主人可读

# 3. 部署（构建镜像 → 等待健康 → 冒烟）
bash scripts/prod/deploy.sh

# 4. 安装每晚 03:00 自动备份（保留 14 天）
bash scripts/prod/backup.sh --install-cron
```

完成后通过 `http://<服务器IP>:3000/admin/`（或你配置的地址）用平台管理员账号登录。
默认不绑定域名，IP 访问即可工作。

## 日常发版

```bash
ssh <服务器>
cd enterprise-skill-library
git pull
bash scripts/prod/deploy.sh    # 分钟级停机窗口；失败会输出容器日志尾部
```

## 服务重启

```bash
bash scripts/prod/restart.sh         # 全部服务
bash scripts/prod/restart.sh api     # 单个服务（api | server | gitea）
```

## 备份与恢复

备份内容：API SQLite 数据库（一致性快照）、上传的技能包、Gitea 全部数据
（仓库/组织/用户）、Bootstrap 机密、`.env`。归档为
`backups/esl-backup-<时间戳>.tar.gz`，权限 600，自动清理 14 天前的旧归档。

```bash
bash scripts/prod/backup.sh                          # 立即备份一次
bash scripts/prod/backup.sh --install-cron           # 安装每晚定时任务
bash scripts/prod/restore.sh backups/esl-backup-<TS>.tar.gz --yes   # 灾难恢复
```

恢复是停服操作；执行前会自动对当前状态打一次「恢复前快照」。

**已知边界**：备份在本机 `backups/` 目录，防误删、防程序缺陷，**不防磁盘物理
损坏**。如需异地容灾，定期将归档拷贝到另一台机器（本手册不展开）。

## 自定义域名与路由

ESL 的默认 nginx 是一个 `default_server`（`server_name _`），不绑定任何域名：
localhost、服务器 IP、以及任意指向本机的域名都能直接访问。

需要**实例特定的路由**时（例如 `www` 官网入口、根域名 canonical 跳转、
官网与管理台分离），在仓库根目录的 `nginx-conf.d/` 中添加 `.conf` 文件：

```nginx
# nginx-conf.d/www.conf —— 示例：www 子域名跳转到管理入口
server {
  listen 80;
  server_name www.example.com;

  location / {
    return 302 https://cloud.example.com/admin/login;
  }
}
```

```nginx
# nginx-conf.d/canonical.conf —— 示例：根域名永久跳转到 www
server {
  listen 80;
  server_name example.com;

  return 301 https://www.example.com$request_uri;
}
```

工作原理：

- 生产 compose 把 `nginx-conf.d/` 挂载到容器的 `/etc/nginx/conf.d`，
  默认 nginx 配置通过 `include /etc/nginx/conf.d/*.conf;` 加载这些文件。
- 声明了具体 `server_name` 的 server 块**优先于** `default_server`；
  未匹配到的请求仍走默认服务。
- 每个路由一个文件，独立增删；产品层升级 nginx 配置不会覆盖实例自定义路由。

`nginx-conf.d/` 已在 `.gitignore` 中，**不纳入版本控制**——域名与路由属于具体
实例。希望对其做版本管理、审阅和回滚时，由实例维护自己的私有部署仓库。

## 启用 HTTPS（原理）

ESL 产品本身不内置证书申请或 TLS 切换脚本。HTTPS 的常见做法是：

- **在反向代理 / 边缘网络终止 TLS**：由 nginx、Caddy、Nginx Proxy Manager、
  云负载均衡或 CDN 在边缘监听 443、管理证书（如 Let's Encrypt），再把请求
  转发给 ESL 的 80 端口。ESL 容器内始终只跑 HTTP。
- **在 ESL nginx 上直接终止 TLS**：把证书挂进容器，在 `nginx-conf.d/` 中添加
  监听 443 的 server 块，并配置 80 → 443 跳转。证书续期由部署者自行安排。

无论哪种方式，证书、私钥和续期配置都属于实例层，不应进入公开仓库或公开构建日志。

## 在局域网通过 Tunnel 发布（原理）

如果 ESL 运行在局域网内、没有公网固定 IP 或无法做端口转发，可以使用出站型
隧道（Cloudflare Tunnel、ngrok、frp、cpolar 等）把服务暴露出去：

- 隧道客户端在本机主动向外部服务发起**出站连接**，因此不需要在路由器或防火墙上
  开放入站端口。
- 隧道边缘终止公网 HTTPS，并把声明的 hostname 转发到 ESL 的 nginx（80 端口）。
- 哪些 hostname 转发到本机、未声明的 hostname 如何拒绝，均由隧道自己的配置
  决定，属于实例层。

ESL 不绑定任何特定隧道厂商。部署者自行选择方案、准备隧道配置和凭据，并通过
compose 或其他编排方式让隧道客户端与 ESL 一起运行；这些文件放入 `.gitignore`
管理的本地目录，不提交到公开仓库。

## Bootstrap Reset 生产护栏

`npm run reset:dev`（Bootstrap Reset，见 ADR-0018）**仅限开发/测试环境**。
脚本检测到 `ESL_ENVIRONMENT=production` 时在任何破坏性操作前直接拒绝——
生产环境的「回到过去」手段只有备份恢复（CONTEXT.md「备份 Backup」「恢复
Restore」词条）。

## 故障排查

- **部署失败**：`deploy.sh` 失败时自动输出各容器日志尾部；手动查看用
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml logs <服务>`
- **冒烟失败**：单独重跑 `bash scripts/prod/smoke.sh [地址]`，逐项核对
  `/health`、API 边界、Git Backend 维护入口
- **Git Backend 恢复入口**：生产环境不暴露 3001 直连端口；Gitea 的维护
  登录页经 `http://<地址>:3000/git/user/login` 访问（与用户同一入口）
- **自定义路由未生效**：检查 `.conf` 文件是否在 `nginx-conf.d/` 中、
  `server_name` 是否拼写正确，并用 `docker exec <server容器> nginx -t`
  验证配置语法
- **日志**：API 诊断日志为 stdout JSON Lines（ADR-0045），由宿主采集；
  compose 已限制单容器日志体积
