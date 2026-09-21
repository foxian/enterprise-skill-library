# Bootstrap Reset 采用数据卷重建

Status: accepted

本地开发环境的"重新初始化"诉求（清空脏数据后回到可用状态）通过删除持久数据卷并由首启初始化路径重建来实现，而不是在服务端或 CLI 内实现逐项清理。ESL 的持久状态横跨三个数据卷：SQLite 数据库（`data/api`）、Gitea（`data/gitea`，组织、用户、团队、仓库）与 Bootstrap 机密（`data/secrets`）。Gitea 侧没有可清空全部状态的删除 API，逐项清理既复杂又易漏（组织、成员、团队、仓库、token 各有残留路径）；数据卷重建是唯一的"零残留"路径。重置由宿主机命令 `npm run reset:dev` 显式触发（见 `scripts/reset-dev-env.mjs`），并复用现有的启动自动建表（`initDatabase`）与 `gitea-bootstrap` 一次性容器完成重建，因此不复制任何初始化逻辑。

## Consequences

重置是破坏性操作，绝不自动触发：脚本默认要求交互确认（`--yes` 可跳过），删除前校验目录内容确实为 ESL 数据（esl.db / repositories / gitea-admin-token 等标记），防止 `--data-dir` 误指向非 ESL 目录时误删。重置脚本只删除三个数据卷子目录，不触碰 `.env`、web 构建产物或其他目录。

重置后本机 ESL CLI 登录态（`~/.skill-library/`）失效，需要重新 `esl login`；脚本在末尾提示。种子数据与重置解耦：`seed.ts` 保持独立命令，重置默认在最后自动 seed（`--no-seed` 可关）；开发环境另可设 `ESL_AUTO_SEED=true` 让服务启动时自动灌入示例技能，生产保持 `false`，与重置脚本的参数正交。
