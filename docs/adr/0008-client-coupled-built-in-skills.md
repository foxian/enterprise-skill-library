# 将客户端配套技能作为 CLI 内置资源

Status: accepted

`esl-operator` 是与 ESL CLI 版本严格配套的 Client-coupled Built-in Skill，而不是
Server-hosted Skill。其唯一可编辑源码位于 `skills/esl-operator/`，CLI 构建从该
目录生成并打包本地 Built-in Skill Package；用户使用 `@builtin/esl-operator` 通过
普通 `install` 安装，但安装从当前 CLI 包读取，不访问 ESL Server，不要求登录或
网络。该技能不进入 Gitea，不创建 Skill ID、Git 仓库、Skill Release 或 Published
Skill Package，不出现在服务器搜索结果中，也不可 upload、publish、source、rename
或 version。

Built-in Skill Package 的 `skill.json` 版本必须等于 `@esl/cli` 的完整 SemVer，
包括 prerelease 标识。构建和 npm 发布前必须校验内置包内容、版本一致性、checksum
和 npm 包包含性。全局安装的内置技能由 CLI 的 npm lifecycle 在 CLI 升级或降级后
自动同步，并只修改 ESL 管理的全局安装记录和 Adapt Manifest 输出；首次全局安装、
项目级安装和项目级更新仍须由用户显式发起。自动同步失败不得阻止 CLI 安装，后续
CLI 执行会重试。普通远程技能继续通过 ESL Server 的 Published Skill Package
安装，只有精确身份 `@builtin/esl-operator` 具有上述本地内置语义。
