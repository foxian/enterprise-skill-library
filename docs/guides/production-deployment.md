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
