# 技能身份 Namespace 归属租户组织

Status: accepted

`@scope/skill-name` 中 scope 段（Namespace）由上传者所属的 **Tenant
Organization** 提供：Source Upload 服务器按调用方的组织作用域账号
（`<org>_<username>`，ADR-0020）解析租户组织，技能 Identity、Git 仓库宿主与
Skill Source 全部落到该租户组织名下（如组织 `esl` 的成员上传得到
`@esl/markdown-master`，仓库为 Gitea 组织 `esl` 下的 `markdown-master`）。
租户组织不 active 时拒绝上传。这推翻 ADR-0007 中「Source Upload 的仓库宿主
固定为单一平台组织 `esl-skills`」的部分，兑现 CONTEXT.md 中 Tenant
Organization「为组织内所有 Server-hosted Skill Identity 提供唯一 Namespace、
组织间技能与源码完全私有隔离」的定义——私有隔离由 Gitea 组织边界天然成立。

## 背景

ADR-0007（Stable Skill Identity 早期设计）把所有技能仓库固定在平台统一组织
`esl-skills` 下，`repoOwner` 作为服务器配置硬编码。ADR-0016/0020 引入多租户
组织后，CONTEXT.md 出现两个互相矛盾的词条：`Namespace` 词条说 scope 由
Platform Organization 占用，`Tenant Organization` 词条说租户组织提供
Namespace 并承诺组织间完全隔离。实现跟随了前者，于是出现三个问题：

1. 默认组织（如 `esl`）的成员登录成功后上传，身份却是
   `@esl-skills/markdown-master`——租户组织在身份里不可见，企业自部署场景
   下技能库命名与企业组织脱节。
2. 组织管理员判定 `${scope}_admin` 指向 `esl-skills_admin`——一个不存在的
   账号（真实组织管理员是 `<租户组织>_admin`），权限判定失效。
3. 多组织模式下所有组织的仓库都建在同一个 Gitea 组织里，「完全私有隔离」
   不成立。

e2e 测试用例（docs/testing/web-console-e2e-test-cases.md）中「历史成员技能
建仓于全局 esl-skills 组织，无法跨组织授权」的教训也是同一矛盾。

## 决策细节

1. **解析来源**：登录 token 只携带组织作用域账号（登录时已按 ADR-0020 校验
   组织归属），服务器用 `parseGiteaUsername`（core 新增，与
   `buildGiteaUsername` 互逆；组织名与用户名均不含下划线，首个下划线即唯一
   分隔点）解析出租户组织。不新增 token 字段、不改 DB schema。
2. **无组织账号拒绝**：平台管理员（`eslroot` 等，无 `<org>_` 前缀）结构上
   无租户组织，上传返回可行动错误——与 ADR-0020「CLI 只服务组织内成员」一致。
3. **租户组织 active 校验**：上传路由按解析出的租户组织校验
   Provisioning State 为 active。onRequest 门禁（app.ts）此前对 upload 流按
   body 短名误查 scope，修正为跳过；该流校验收敛到路由内。
4. **repoOwner 的遗留定位**：服务器配置 `repoOwner`（默认 `esl-skills`）不再
   参与 Source Upload；仅遗留的包形态发布流（`POST /api/skills`，管理后台
   创建带版本技能，Identity 由调用方声明、仓库宿主为 repoOwner）与
   Bootstrap 状态检查（`/api/admin/bootstrap/status` 的 repoOwner 项）继续
   消费它。CLI 不消费该遗留流；是否将其统一到租户组织归属，留待后续决策。
5. **CLI 无需变更**：CLI 从服务器响应与 Source Remote URL 派生身份，不含
   scope 假设；`esl status`/`upload` 的 remote 匹配逻辑按仓库短名比较，不受
   宿主组织变化影响。

## Consequences

- 单组织部署的技能库身份为 `@<默认组织>/skill-name`；Bootstrap 开通的组织
  （`ESL_DEFAULT_ORG`）就是上传宿主，部署声明错误会直接表现为上传报「租户
  组织不 active」或 Gitea 组织缺失错误。
- 多组织模式获得真实的组织级隔离：每个租户组织一个 Gitea Organization，
  仓库互不可见（Gitea 组织边界），权限矩阵在组织内运作。
- `createdBy`/`owner`/`maintainers` 继续存组织作用域账号全名（现状），展示层
  按既有约定处理。
- ADR-0007 的「单一平台组织持有所有仓库」从 Source Upload 链路退役，仅在
  遗留包形态发布流与 Bootstrap 状态检查中存续；ADR-0009 的 Scope/Namespace
  分类（含保留 Scope）语义不变，归属方由 Platform Organization 改为
  Tenant Organization。
