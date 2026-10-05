# 生产部署与运维手册

ESL 生产部署基线见 ADR-0047：单台 Linux 服务器 + Docker Compose，生产配置以
override 叠加在开发栈之上，开发/生产脚本按运行环境分目录。服务器唯一前置依赖：
**Docker 与 git**（无 node）。

## 核心概念对照

| 概念 | 开发环境 | 生产环境 |
|------|---------|---------|
| 运行配置 | `docker compose up` | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up`（下称「生产 compose 命令」） |
| Git Backend 直连 | 宿主 3001 端口（E2E/调试） | 不暴露，仅经 `/git/` 反代（ADR-0004） |
| 前端 | 本机构建 dist 挂载 | 烤入 `server` 镜像（回滚 = 换回旧镜像） |
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
                 #      ESL_SERVER_URL=http://<服务器IP>（域名就绪后改为 https://<域名>）
chmod 600 .env   # .env 含秘密，仅文件主人可读

# 3. 部署（构建镜像 → 等待健康 → 冒烟）
bash scripts/prod/deploy.sh

# 4. 安装每晚 03:00 自动备份（保留 14 天）
bash scripts/prod/backup.sh --install-cron
```

完成后访问 `http://<服务器IP>:3000/admin/` 用平台管理员账号登录。

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

## 启用 HTTPS（域名就绪后）

```bash
bash scripts/prod/enable-tls.sh <域名> [certbot邮箱]
```

一次性完成：certbot standalone 签发（期间 server 容器停约数十秒）→ 生成
`docker-compose.prod.tls.yml` → 443 切换 → 每周一 03:30 自动续期 cron →
HTTPS 冒烟验证。前提：域名 DNS 已解析到本服务器。

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
- **日志**：API 诊断日志为 stdout JSON Lines（ADR-0045），由宿主采集；
  compose 已限制单容器日志体积

## 局域网本机通过 Cloudflare Tunnel 发布

如果 ESL Server 运行在局域网本机，且域名由 Cloudflare 管理，推荐使用 Cloudflare
Tunnel。Tunnel 由本机向 Cloudflare 发起出站连接，因此不需要路由器端口转发、固定公网
IP 或把 80/443 暴露到互联网。Cloudflare 边缘负责公网 HTTPS，Docker 内的 nginx 只需
继续监听宿主机 `3000`。

本节假设公开服务入口为 `cloud.enterprise-skills.com`。根域名、`www`、`docs` 和
`status` 的示例路由也已写入 `docker/cloudflared/config.yml.example`，其中后两个
hostname 如果暂时没有对应内容，可先不在 Cloudflare 中创建 DNS 路由。

### 1. 创建 Tunnel 和 DNS 路由

在本机确认已安装 `cloudflared`，然后执行：

```bash
cloudflared tunnel login
cloudflared tunnel create esl-local
cloudflared tunnel route dns esl-local enterprise-skills.com
cloudflared tunnel route dns esl-local www.enterprise-skills.com
cloudflared tunnel route dns esl-local cloud.enterprise-skills.com
```

命令会在 `~/.cloudflared/` 下生成 Tunnel 凭据 JSON。该目录包含私密凭据，不要提交
到 Git，也不要把它挂载为可写目录。

### 2. 配置 ingress

复制示例并把 `REPLACE_WITH_TUNNEL_UUID` 替换为 `cloudflared tunnel create` 输出的
Tunnel UUID：

```bash
cp docker/cloudflared/config.yml.example ~/.cloudflared/config.yml
chmod 600 ~/.cloudflared/config.yml ~/.cloudflared/<TUNNEL-UUID>.json
```

Tunnel 配置将 `cloud.enterprise-skills.com` 转发到 Compose 网络内的
`http://server:80`，最后的 `http_status:404` 会拒绝未声明的 hostname。不要把
`api`、`git`、数据库、缓存、Gitea 维护端口或 Docker daemon 加入 ingress。

### 3. 启动生产栈和 Tunnel

在仓库根目录创建生产 `.env`，至少设置：

```dotenv
ESL_ENVIRONMENT=production
ESL_SERVER_URL=https://cloud.enterprise-skills.com
CLOUDFLARED_CONFIG_DIR=/home/<user>/.cloudflared
```

然后执行：

```bash
bash scripts/prod/deploy.sh
```

只要 `CLOUDFLARED_CONFIG_DIR` 非空，部署和重启脚本会自动叠加
`docker-compose.tunnel.yml`，并启动 `cloudflared` 容器。验证：

```bash
curl -fsS https://cloud.enterprise-skills.com/health
curl -I https://enterprise-skills.com/
```

根域名应返回永久跳转到 `https://www.enterprise-skills.com`；CLI、API 和 Git 统一
使用 `https://cloud.enterprise-skills.com` 这一 origin。尚无官网主页前，`www` 的根路径与 `/admin` 会临时 302 到 `https://cloud.enterprise-skills.com/admin/login`（及对应 admin 路径），避免 www 继续充当控制台入口。

### Cloudflare Tunnel 注意事项

- Cloudflare Dashboard 中 TLS 模式应至少为 **Full**；Tunnel 到本机这一段是 Docker
  内网 HTTP，不需要在 ESL nginx 中签发证书。
- 使用 Tunnel 时不要执行 `scripts/prod/enable-tls.sh`，也不要为本机配置 certbot
  standalone；这两者要求公网入站 80/443，与局域网 Tunnel 架构无关。
- `cloudflared` 容器没有 `ports` 配置，公网流量只能经 Tunnel 到达 ESL 网关。
- 如果局域网主机重启，Docker 的 `restart: unless-stopped` 会自动恢复 Tunnel；仍应
  通过 `docker compose ... logs cloudflared` 检查连接状态。
- Cloudflare Access、WAF、速率限制和 DNS 记录属于 Cloudflare 运维配置，不改变 ESL
  Server 的 `cloud` origin 契约。
