# 稳定技能身份与平台仓库路径设计

> 日期：2026-08-05
> 状态：待用户审阅

## 1. 背景

技能可能从个人维护转为团队或平台维护。如果技能名称、scope 或 Git 仓库地址随着当前 owner 改变，已经安装的客户端、本地目录、工具链接和 lockfile 都需要迁移，容易造成断链。

本设计将技能的公开名称、创建人、当前归属和 Git 仓库所有权分开，使人员离职、维护者变更和权限调整不会改变客户端使用的名称或 Git 地址。

## 2. 设计目标

- 技能创建后，公开名称和 Git 地址保持稳定。
- 创建人离职时，只撤销权限，不迁移技能。
- Git 仓库由平台统一组织持有，不绑定个人 Gitea 账号。
- 个人、团队和平台维护权限可以独立变化。
- 客户端不需要因为 owner 变化而移动本地技能目录或重建工具链接。
- 保持类似 npm 的 `@scope/name` 使用体验。

## 3. 命名规则

技能的公开名称格式保持：

```text
@scope/skill-name
```

规则：

- `scope` 在技能创建时确定，默认使用创建人的稳定用户名。
- `scope` 创建后不可修改，也不随当前 owner 或 maintainer 改变。
- `skill-name` 创建后不可修改。
- 如果需要完全不同的名称，创建新的技能，并将旧技能标记为 deprecated。
- scope 和 skill-name 使用小写字母、数字和连字符。

示例：

```text
@alice/code-review
@alice/k8s-debugger
```

这里的 `alice` 表示创建时分配的永久命名空间，不表示当前一定由 Alice 维护。

## 4. Git 仓库路径

Gitea 使用平台统一组织 `esl-skills` 持有所有技能仓库。仓库名称由 scope 和 skill-name 组成，中间使用下划线：

```text
@alice/code-review
-> esl-skills/alice_code-review.git
```

完整 Git 地址由服务端配置的 Git base 和数据库中的 `gitRepoPath` 组合得到：

```text
http://localhost:3001/esl-skills/alice_code-review.git
```

规则：

- `gitRepoPath` 在首次创建技能时生成并持久化。
- 客户端使用服务端返回的 `gitRepoPath`，不自行拼接仓库地址。
- 技能名称变更不通过修改已有仓库路径实现。
- 仓库路径不会因为 owner、maintainer 或创建人权限变化而改变。
- `esl-skills` 组织由平台管理员控制，个人账号只通过权限访问仓库。

## 5. 身份与权限模型

技能元数据至少区分以下字段：

```text
name        @alice/code-review
scope       alice
createdBy   user-alice
owner       platform 或组织标识
maintainers user-bob, team-platform
gitRepoPath esl-skills/alice_code-review.git
```

字段语义：

- `createdBy`：最初创建技能的用户，只用于审计和追溯，不随维护权变化。
- `owner`：当前业务归属方，可以是平台或组织。
- `maintainers`：拥有写入或发布权限的用户、团队列表。
- `gitRepoPath`：平台统一管理的 Git 仓库路径。

权限建议：

```text
read    可以查询并 clone
use     可以安装和使用
write   可以推送代码和发布新版本
admin   可以修改权限、归档或删除技能
```

第一阶段可以继续使用 `public/private` 可见性和发布者写权限；数据模型预留 owner/maintainers，后续再实现团队级权限。

## 6. 生命周期

### 6.1 创建

1. 用户创建 `@alice/code-review`。
2. API Server 生成 metadata。
3. API Server 在 `esl-skills` 下创建 `alice_code-review` 仓库。
4. `gitRepoPath` 写入数据库。
5. 创建用户获得 admin/write 权限。

### 6.2 共享或交接

共享或交接只改变权限和归属：

```text
name:        @alice/code-review
gitRepoPath: esl-skills/alice_code-review.git
owner:       platform
maintainers: bob, team-platform
```

客户端不需要改名、移动目录或更新 Git remote。

### 6.3 创建人离职

1. 禁用创建人的账号或 token。
2. 移除其 write/admin 权限。
3. 保留技能 metadata 和 Git 仓库。
4. 将维护权限交给其他用户或平台团队。

以下内容保持不变：

```text
@alice/code-review
esl-skills/alice_code-review.git
.skills/@alice/code-review
```

### 6.4 技能改名

V1 不支持原地改名。需要新名称时：

1. 创建新的技能名和仓库。
2. 旧技能标记为 deprecated。
3. 文档中指向新技能。

这样避免 alias、Git redirect 和本地依赖迁移。

## 7. 客户端本地存储

项目级技能应保留 scope，避免同名冲突：

```text
.skills/@alice/code-review/
```

全局技能应使用相同的逻辑结构：

```text
~/.skill-library/skills/@alice/code-review/
```

工具适配器应指向该稳定路径。owner 或 maintainer 变化时，不需要更新链接。

## 8. API 与实现边界

服务端：

- `POST /api/skills` 根据 `name` 解析 scope 和 skill-name。
- 仓库创建目标固定为 `esl-skills`。
- 仓库名生成后写入 `gitRepoPath`。
- 后续 publish 使用已保存的 `gitRepoPath`，不能重新根据当前 owner 生成。
- 返回 metadata 时同时返回 `createdBy`、`owner`、`maintainers` 和 `gitRepoPath`。

CLI：

- `publish` 发送 skill name 和版本，使用 API 返回的 `gitRepoPath` 推送。
- `install` 使用 API 返回的 Git 地址。
- `installTargetDir` 必须保留 scope，不能只使用 skill-name。
- CLI 不负责判断 scope 对应的是用户还是组织。

## 9. 非目标

本设计暂不实现：

- 组织作为公开 scope。
- 技能原地重命名。
- 技能名称 alias 或 redirect。
- 完整团队权限管理。
- 多仓库迁移和 Git 历史复制。
- 个人 Git 仓库作为技能正式存储位置。

## 10. 验证标准

实现后至少验证：

1. 创建 `@alice/code-review` 时，仓库创建在 `esl-skills/alice_code-review.git`。
2. `search` 和 `info` 返回稳定的 skill name 和 `gitRepoPath`。
3. `publish` 可以将本地 Git 仓库推送到平台组织仓库。
4. `install` 将技能放到 `.skills/@alice/code-review` 或全局对应路径。
5. 移除 Alice 权限后，Bob 仍可以维护同一个技能和 Git 地址。
6. 同名技能可以共存：

```text
@alice/logger
@bob/logger
```

7. `npm test` 和 `npm run build` 通过。
