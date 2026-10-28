# ESL Server 实例身份与客户端来源隔离

Status: accepted

## Context

ESL CLI 原先以 `@scope/skill-name` 作为本地技能 Store 和工具链接的主要身份。
这个身份只在一个 ESL Server 实例内具有唯一性，因此两个不同实例可以同时提供
同名技能。若客户端把它们放进同一个 Store，后安装的技能会覆盖或复用先安装的
路径；工具链接也无法表达实际来源。

同时，Server 的用户可见地址可能在整体迁移、域名切换或反向代理调整后发生变化。
地址变化不应让同一实例的 Skill ID、技能 Git 仓库或已安装来源变成新的技能来源。
反过来，两个独立实例即使使用相同的技能 Identity，也不能因为名称相同而自动
建立来源关系。

当前系统尚未提供公钥/私钥认证。仅凭新地址返回的 Instance ID，客户端无法证明
该地址确实属于原实例；它只能判断两个地址提出了相同的实例身份声明。

## Decision

### 1. 实例身份

- 每个 ESL Server 实例在首次初始化时生成一个随机 UUID 作为 Instance ID，并将其
  持久保存。
- Instance ID 在重启、升级、整体迁移和备份恢复时保持不变；独立创建的新实例
  生成新的 Instance ID。
- Instance ID 是来源标识，不是认证凭据。当前版本不把它作为真实性或所有权的
  密码学证明。
- Server 提供只读的实例身份发现能力。该能力允许匿名读取实例 ID 和必要的协议
  兼容信息，但不授予技能访问、账户信息或其他受保护资源的权限。

### 2. 客户端登记与发现

- CLI 在用户级配置中登记多个 Server 实例、每个实例的一个或多个地址、首选地址、
  Instance ID 以及地址确认状态；凭据单独保存。
- CLI 启动时若默认地址没有本地 Instance ID 缓存，则尝试读取并缓存；读取失败
  不阻止本地命令运行。需要远程身份的命令在执行时再次尝试，失败才报告远程错误。
- 同一实例可以登记多个地址。CLI 优先使用首选地址，首选地址不可用时尝试同一
  实例的其他已登记地址。
- 旧版只有单个 Server URL 的配置迁移时保留原地址和凭据；能连接时补充 Instance
  ID，不能连接时保留待迁移状态，不猜测或丢弃身份信息。

### 3. 地址确认与异常

- 新地址返回已知 Instance ID 时，CLI 将其视为“可能是同一实例的地址”，而不是
  已经完成真实性验证。
- 新地址首次登记必须向用户显示可能伪造的安全提示，并要求用户确认。确认记录
  只表示该用户在该客户端接受地址与 Instance ID 的绑定，不构成密码学信任。
- 已确认的地址再次使用时不重复提示，但 CLI 仍检查它返回的 Instance ID。
- 已登记地址返回不同 Instance ID 时，CLI 报错并阻止静默改绑。用户必须先移除
  旧登记，再显式重新添加该地址，才能将它登记为新实例。
- 新地址返回此前未知的 Instance ID 时，按新实例登记，不自动迁移旧实例的技能、
  凭据或来源记录。

### 4. 本地 Store 与工具链接

- Server-hosted 技能的本地 Store 按 Instance ID 隔离。概念路径为：
  `.eslib/skills/<完整InstanceID>/@scope/skill-name`；全局 Store 使用同样的
  实例层级。
- Instance ID 使用完整 UUID 保存在配置、安装清单、项目依赖锁定信息和 Store
  路径中。CLI 不从 UUID 推导域名或组织名。
- 工具链接目录使用技能 Identity 加 Instance ID 的短前缀，例如
  `scope_skill-name_<短前缀>`。创建链接时检测冲突；发生冲突时逐步增加前缀长度，
  直到目录名唯一。
- `@builtin/*` 技能不属于任何 Server 实例，继续使用内置技能的保留路径和来源
  语义，不放入 Instance ID Store 层级。

### 5. 项目依赖

- `.skills.json` 声明项目直接依赖的 Server-hosted Skill Identity、Instance ID
  和版本范围；内置技能使用 `builtin` 来源语义。
- `.skills-lock.json` 记录精确版本、Skill ID、Instance ID、完整性信息及复现所需
  的其他不可变数据。
- 锁文件不把 Server URL 当作实例身份。地址是连接方式，Instance ID 是来源标识；
  客户端从本机已登记的地址中找到对应实例。
- `.skills.json` 和 `.skills-lock.json` 属于项目配置，可提交到项目自己的 Git
  仓库；实际 `.eslib/skills` 安装内容通常不提交。旧依赖文件由用户手动清理，CLI
  不自动删除用户的旧依赖或 Store 内容。

### 6. Source Remote 迁移

- 本地技能源码仓库中的 `origin` 仍由用户管理，不受 ESL Server 地址迁移影响。
- `esl` remote 指向 ESL Server 托管的技能源码仓库。
- 当旧地址和新地址属于同一个 Instance ID，且当前 Server 验证 Skill Identity、
  Skill ID 与 Git 仓库路径一致时，`esl upload` 可将 `esl` remote 重指到 Server
  返回的新 clone URL，并继续上传。
- Instance ID 不同，或来源无法验证时，CLI 不自动重指、不创建新的 Skill ID、
  不接管其他实例的仓库；用户必须显式选择跨实例播种或重新登记流程。

## Considered Options

- **继续只使用 Skill Identity 作为本地键**：拒绝。不同实例的同名技能会冲突，且
  客户端无法稳定表达来源。
- **把 Server URL 作为技能来源主键**：拒绝。地址可迁移，同一实例的来源会因域名
  变化而被错误拆分；URL 仍作为连接地址保存，但不作为身份。
- **要求用户每次命令传入 Instance ID**：拒绝。当前 Server 上下文和项目依赖已能
  确定来源；Instance ID 由 CLI 自动发现和使用。
- **新地址只要返回相同 ID 就自动信任**：拒绝。当前没有密码学认证，相同字符串可能
  被伪造；改为首次地址登记时人工确认。
- **发现 ID 不匹配时自动覆盖本地绑定**：拒绝。会把已安装技能、锁文件或 Git
  remote 静默指向另一实例；改为阻止并要求显式移除后重新登记。
- **用完整 UUID 作为工具链接目录名**：拒绝。完整 UUID 适合权威身份和 Store
  隔离，但会不必要地拉长工具目录；改为带冲突检测的短前缀。

## Consequences

- 不同 ESL Server 实例上的同名技能可以在同一个全局或项目 Store 中并存，不会因
  安装顺序互相覆盖。
- Server 地址迁移可以保留 Skill ID、Git 历史和项目来源，但新地址首次登记会有
  一次人工确认，提醒用户当前仍缺少密码学身份验证。
- Instance ID 解决来源隔离和迁移连续性，不解决 Server 真实性。后续加入公钥/私钥
  认证时，应在地址登记确认流程上增加指纹或签名校验，而不是改变 Instance ID 的
  语义。
- 项目依赖可以跨机器复现同一个实例来源，但每台机器仍需登记该实例的可用地址和
  凭据；锁文件本身不携带认证信息。
- 内置技能与 Server-hosted 技能保持清晰边界，不受多实例隔离和 Server 地址迁移
  影响。
