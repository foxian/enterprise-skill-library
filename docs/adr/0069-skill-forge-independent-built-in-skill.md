# 将 skill-forge 作为独立版本的内置技能

Status: accepted

## Context

ESL 已有与 CLI 严格配套的 `@builtin/esl-operator`。仓库中的 `skills/skill-forge/`
提供技能创建、评测和描述优化工作流，也需要通过 ESL 的离线内置技能安装机制分发。
它的内容生命周期独立于 CLI，不应因为 CLI 的修订版本而强制改变技能版本。

## Decision

新增 `@builtin/skill-forge`。CLI 构建从 `skills/skill-forge/` 读取源码，版本以该目录
中的 `skill.json` 为准，初始版本为 `1.0.0`。`@builtin/esl-operator` 继续使用 CLI
完整 SemVer；两个内置包都进入 `builtin-packages.json` 和 CLI npm 包。

`skill-forge` 的安装、更新、卸载、适配、信息查看和使用遵循普通内置技能语义：不访问
Server、不要求登录或网络，锁文件使用 `source: "builtin"` 与 `builtin:skill-forge`。
它不进入 Server 搜索，也不可 upload、publish、source、rename 或 version。

`skill-forge` 不参与 CLI 升级或降级后的全局自动同步。用户必须显式执行 update；若
当前 CLI 携带的版本低于已安装版本，update 拒绝降级。

构建会保留技能运行所需的文档、脚本、viewer、资源和许可证，排除缓存、Python 字节码、
`.gitignore`、`.skill` 示例产物和其他构建缓存。Python、PyYAML、外部 AI CLI、浏览器和
本地 HTTP 服务是技能运行能力的可选环境依赖，不由 ESL CLI 安装器提供。

## Consequences

- 用户可以在离线环境中显式安装 `@builtin/skill-forge`。
- `skill-forge` 可以独立 bump 版本，不必随 CLI 版本同步。
- CLI 升级不会静默替换全局 `skill-forge`；用户需要显式 update。
- 安装成功不代表自动评测环境依赖已经具备，技能文档必须说明能力降级。
- 内置构建器需要支持多个包和按包选择版本来源。
