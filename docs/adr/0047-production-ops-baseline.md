# 生产运维基线：Compose override、应用层一致性备份与开发/生产脚本分离

Status: accepted

ESL 从单机开发栈走向生产部署（单台 Linux 服务器 + Docker Compose），需要确立三条基线决策。

**一、生产配置采用 override 叠加而非独立文件。** 生产运行时为
`docker compose -f docker-compose.yml -f docker-compose.prod.yml`：基础文件承载与服务
拓扑，生产 override 只做差异——去掉 Gitea 3001 端口暴露（开发/E2E 专用，生产仅经
`/git/` 反代，符合 ADR-0004 单入口约束）、对外地址由 `ESL_SERVER_URL` 参数化（不再
写死 `localhost`）、`server` 服务改用烤入前端产物的 nginx 镜像（`docker/web.Dockerfile`
多阶段构建）替代开发期的 dist bind-mount。取舍：独立生产文件会有复制粘贴漂移风险，
override 的代价是生产正确性部分依赖基础文件的克制（dev 专用配置必须以「可被 override
关闭」的方式表达）。前端烤入镜像换来不可变与可回滚（保留旧 tag 即回滚点），代价是
每次发版必须重建镜像，放弃开发期「重建 dist 即生效」的轻量路径——该路径保留在开发
环境，通过 override 的镜像替换天然隔离，二者不互相污染。

**二、备份采用应用层一致性导出而非停机打包或卷快照。** ESL 持久数据横跨三个目录
（`data/api` SQLite、`data/gitea`、`data/secrets`，见 ADR-0018），其中两个 SQLite 库
在服务运行中持续写入，直接 tar 可能得到损坏副本。备份脚本（`scripts/prod/backup.sh`）
不停机执行：经 `docker compose exec` 用 SQLite `.backup` API 导出一致性快照，Gitea 侧
用官方导出能力，连同 `data/secrets` 与 `.env` 打成带时间戳的单文件归档，保留 14 天、
每晚 cron 触发。取舍：停机 tar 一致性绝对但引入备份窗口停机；卷快照依赖存储驱动且
对 bind mount 不适用；应用层导出在单机场景一致性足够（SQLite backup API 保证快照点
一致），代价是备份逻辑与两个应用的导出接口耦合。恢复（`scripts/prod/restore.sh`）
是停服操作，执行前先打「恢复前快照」防止恢复操作本身失败后无路可退。备份含
`.env`，故 backups 目录权限 600 且归档不得外传。异地备份明确不做：本方案防误删与
程序缺陷，不防磁盘物理损坏。

**三、开发与生产脚本按运行环境分目录，且 Bootstrap Reset 永不进入生产。** 开发脚本
（node `.mjs`，跨平台，运行于开发机）留在 `scripts/`；生产脚本（bash，运行于只装
Docker 的服务器）收入 `scripts/prod/`，服务器正规入口是 `bash scripts/prod/*.sh`，
npm 别名仅为开发机便利。`reset:dev`（ADR-0018 的 Bootstrap Reset）增加生产护栏：
检测到生产运行环境时拒绝执行——生产的「回到过去」手段只有备份恢复，重置是开发/测试
专属概念。TLS 不作为首日阻塞项：先以 HTTP + `ESL_SERVER_URL` 上线，域名就绪后由
`scripts/prod/enable-tls.sh` 一次性完成 certbot 签发与 443 切换。

## Consequences

生产部署接受分钟级停机窗口（企业内部工具，非高可用服务），不做双实例与滚动更新；
无 CI/CD，发版为人工 `git pull` + `deploy.sh`，后续如需自动化可在其外包一层。生产
脚本只依赖 bash 与 docker，冒烟检查（对齐 `check-git-backend-maintenance-entry` 的
语义）以 curl 实现。api 镜像 Dockerfile 中写死的中国镜像源需参数化，以兼容海外服务
器。本 ADR 实施随生产部署脚本工作交付，运维手册见 `docs/guides/production-deployment.md`。
