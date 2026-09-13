# npm 式身份模型重构 — 设计共识

> 来源：2026-09-13 grilling 设计会。术语表已更新（CONTEXT.md），决定记录于 ADR-0032。

## 背景现状

- 今天的"用户"是 Gitea 账号 `<org>_<username>`，一个 (组织, 用户) 对一个账号，跨组织 = 多个独立账号
- 技能身份 `@scope/name` 从 git remote URL 推导，release.json 没有 `name` 字段
- 组织创建走申请 → 审批 → 异步 Operation 开通；组织间完全私有隔离
- Gitea 是成员关系、团队、仓库权限的事实来源；ESL DB 没有 users 表

## 目标模型

### 身份层（Gitea 为事实源）

1. 用户 = 全局 Gitea 账号，无 `<org>_` 前缀；平台自助注册（`registration_mode: open | approval`，超管设置，默认 open），注册即拥有个人命名空间 `@用户名`
2. 组织 = Gitea Organization；任何注册用户可创建多个组织（`org_registration_mode: auto | manual` 保留：auto = 同步即时创建；manual = 申请审批后同步开通；**Operation/Provisioning 机制整体退役**）
3. scope 名单一扁平池：组织名与用户名共享、先到先得、保留名（`local` `builtin` `admin` `api` `git` `system`）不可用
4. 用户名与组织名**不得改名**；登录不再传 org；`<org>_admin` 账号、system-admins 团队、single/multi 部署模式、默认组织 bootstrap 全部废除

### 组织内部

5. 角色：组织管理员（= Gitea Owners 团队成员，创建者是初始成员，**所有** Owners 成员均可管理成员/团队/组织设置，并可见、管理本组织全部技能）+ 普通成员
6. 四个常设团队：**组织只读团队、组织读写团队、组织技能管理团队、组织管理员团队（Owners）**；成员加入组织时自动加入前三个、离开时自动移出；常设团队不可删除/改名，自定义团队可由组织管理员创建/改名/删除
7. 拉人方式（邀请制 / 直接添加）为超管可配置的平台设置
8. 任何组织成员可在组织命名空间下 upload 新技能，上传者成为初始 Maintainer

### 技能与发布

9. release.json **v3** 新增必填 `name` 字段（完整 `@scope/skill-name`），是技能归属的唯一权威来源；`esl init` 即写入，默认 `@用户名/技能名`
10. `esl upload` 按 release.json 的 `name` 在对应命名空间创建 Gitea 仓库（`{scope}/{name}`；个人技能 = 个人仓库），需校验上传者对该命名空间的权限（个人 / 组织成员）
11. `publish` 只**断言** `name` 与技能既定身份一致，不一致报错——归属变更不得借发布顺车
12. 命名空间内改名保留（现有 rename + 301 redirect 机制）；**跨命名空间移动 v1 禁止**
13. 可见性逐技能设置：`public` = 平台全员可搜可装；`private`（默认）= 仅 Maintainer 与被授权者（团队/成员，沿用现有权限矩阵）；由组织管理员或技能 Maintainer 切换
14. 组织成员对组织内 private 技能**默认零权限**；授权 = 共享给常设团队，或逐技能加团队/成员

### CLI / Web

15. CLI 登录 `username + password`；配置中 org/role 字段移除
16. Web：普通成员 = 跨命名空间聚合的个人中心（个人 + 所有组织技能，按 managed/shared 标注）；组织管理员页管成员与团队；超管控制台管申请审批/平台设置/注册模式

### 申请查重（manual 模式）

17. 组织注册申请**提交时即查重**：组织名已存在或已有同名待审申请 → 直接拒绝；超管拒绝申请即释放名字；冲突不会到达审批环节

### 数据

18. 现有数据推倒重来（`npm run reset:dev` 重建），不做迁移；legacy `POST /api/skills` 路径删除

## 实施注意（来自现有代码事实）

- 改 server 需重建 api 镜像；改 web 需 deploy:web；cli/server 测试读 core 的 dist
- DB schema 是裸 SQL DDL + `ensureColumn` 补丁，没有迁移框架——本次大改可直接改 DDL（反正 reset 重建）
- 发布物路径按 skillId 存放，scope 变更不影响包路径，但本次无迁移所以无影响
- Gitea 原生支持全局账号池、org、Owners 团队、团队权限、个人仓库——大部分"新"能力是删除 ESL 侧的拼装逻辑，不是新建

## 关联

- 术语表：`CONTEXT.md`（Namespace、Organization、常设团队、技能可见性、用户注册、个人命名空间 等已重写）
- 决定记录：`docs/adr/0032-npm-style-identity-flat-namespace-pool-and-authoritative-release-name.md`（取代 ADR-0016/0022/0024/0026，部分取代 ADR-0020）
