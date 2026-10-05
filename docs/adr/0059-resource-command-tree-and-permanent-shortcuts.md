# ESL CLI 收敛为资源式命令树，Tool Link 降为安装的内部结果

Status: accepted

ESL CLI 把消费者、技能作者、Release 治理、账号配置和本地链接操作平铺在同一层，`list`/`link`/`tools *`/`source`/`upload`/`publish` 分属不同资源与生命周期，用户要靠大量约定才能判断一条命令是查 Registry、写本地 Skill Store、改本地源码，还是建 Tool Link；同时 Source Link 与 Tool Link 两个方向不同的链接共用入口，容易混淆。我们决定：以 `skill`、`source`、`release`、`account`、`config` 五个资源为命令主语，另保留一组**永久顶层快捷入口**与资源路径**行为等价**。

正式命令树：

```text
esl skill search|info|install|list|update|uninstall|use|share
esl source init|validate|status|upload|clone|reset|rename
esl release version|publish
esl release depend add|remove|list
esl release notes|deprecate|delete|repair-tag
esl account login|logout|whoami|change-password
esl config set-server|preferred-tools
esl link <local-source-path>
esl unlink <skill-identity>
```

永久顶层快捷命令（与对应资源路径等价）：`search`、`info`、`install`、`list`、`update`、`uninstall`、`version`、`publish`、`login`、`logout`、`whoami`、`link`、`unlink`。`esl use` 不保留顶层入口，只用 `esl skill use`；`init`/`validate`/`status`/`upload`/`clone`/`reset`/`rename`/`depend`/`notes`/`deprecate`/`delete`/`repair-tag`/`share` 只有资源路径。命令层不再按远端/本地二次拆分：`skill info` 永远查 Registry，`skill list` 永远查当前项目或全局 Skill Store，语义不随本地是否已安装或网络可用性改变。

`link` 是唯一的 Source Link 用户入口，`link`/`unlink` 保持顶层。**Tool Link 从独立 CLI 资源降为安装的内部结果**：删除公开的 `tools` 命令面（`tools list`/`sync`/`remove`/`preferred`），但保留 Tool Link Manifest 与安全对账规则——`skill list` 展示每条安装的 Tool Link 状态，`skill update` 自动修复已记录的 link，`skill uninstall`/`unlink` 安全移除 ESL 管理的 link。`--tools` 与 TTY 勾选表达**期望 Tool Link 集合**（ADR-0054）：补齐集合内、删除集合外 ESL 管理的 link、保护 unmanaged 内容；非交互缺显式 `--tools` 时报错，绝不静默。原 `tools preferred` 改名为 `config preferred-tools`，且**只影响 TTY 的初始工具预选**，显式 `--tools` 优先，绝不改变脚本/Agent 的非交互行为。已删除的顶层命令不保留隐藏、弃用或兼容别名，新树只有一条权威路径。

拒绝的备选：保留 `tools` 作为独立资源（Tool Link 是安装产物，不是用户要管理的对象）；把 `link`/`unlink` 塞进 `source`（Source Link 的主语是 Skill Store 安装位，不是源码仓库）；把 `skill` 再拆成 `registry`/`store` 两个命名空间（用户不该先判断远端还是本地）；为每个资源路径都保留同名顶层别名（会把顶层帮助重新堆满）；让 `info` 在本地已安装时改读本地状态（同一命令两种语义正是要消除的问题）；`config preferred-tools` 影响非交互执行（会静默改变脚本与 Agent 的安装结果）。
