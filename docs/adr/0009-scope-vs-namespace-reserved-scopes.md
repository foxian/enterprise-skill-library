# 区分 Scope 与 Namespace：保留 Scope 用于本地与内置

Status: accepted

Skill Identity 形式 `@scope/skill-name` 中的 `scope` 是一个比 Namespace 更广的机械层概念：它是身份的第一段，adapt 引擎按它生成安装目录名（`scope_skill-name`）与展示名（`scope:skill-name`）。Namespace 是 Scope 的一个保留段，专由 Platform Organization 占用，带不可变 / Bootstrap 配置等治理语义。`local` 与 `builtin` 是另外两类**保留 Scope**，不带治理语义，分别用于从 Local Skill Source 安装的草稿和随 ESL CLI 发行包携带的 Built-in Skill；它们不是 Namespace，不参与 Skill Rename，不可 `publish`（`@local/*` 拦截发布）或 `upload / publish / source / version / rename`（`@builtin/*` 由 ADR-0008 决定）。这条拆分是 ADR-0008 落地的术语前置：若没有它，`@builtin/esl-operator` 的 adapt 目录名与展示名是无名规则，CONTEXT 现有的 `namespace_skill-name` / `namespace:skill-name` 措辞对它字面上不适用；同时它也是 `@local/*` 一贯被 adapt 引擎按同一条机械规则处理（产出 `local_foo` / `local:foo`）却长期在模型里无名的事后归位。Skill Rename 进一步收紧：只改短名，不改 scope 段；scope 段由 Platform Organization 锁定。Scope 升格后，所有 Server-hosted Skill Identity 的 scope 即其 Namespace，所有保留 scope 下的身份按统一机械规则进入工具目录，模型自洽。

## Consequences

- `Namespace` 定义收窄为「由 Platform Organization 占用的 Scope，带治理语义」，不再覆盖 `local` / `builtin`。
- `Local Namespace` 在 CONTEXT 中改名为 `Local Scope`，新增 `Built-in Scope`。
- `Skill Identity` 形式从 `@namespace/skill-name` 改为 `@scope/skill-name`，定义里点明 server-hosted 的 scope 即其 Namespace。
- 两条 Adapted Skill Name 定义措辞从「namespace-qualified」改为「scope-qualified」。
- 实现层不需要改：`parseSkillName` 与 `adaptedSkillDirectoryName` / `adaptedSkillDisplayName` 本就按 scope 机械拆分，没有「Scope」概念的代码侧无变化；这次改动是术语层归位。
- 仓内所有使用「local namespace / Local Namespace / 命名空间」措辞的文档与技能 reference 需要随这次 ADR 同步术语，避免再次漂移。
