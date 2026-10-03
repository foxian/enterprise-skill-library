# 发布依赖是安装图，不是调用组合

Status: accepted

「技能依赖技能」容易被理解成 Agent 用 A 时自动加载 B。我们决定：发布依赖
（Release Dependency）只描述安装图——装 A 必须得到 B——不描述调用组合。
宿主如何把多个技能拼成一次会话，仍由根技能的 SKILL.md 正文约定；ESL 不在
frontmatter 或清单里发明运行时 `depends` 协议。

主场景是共享基础技能（style-guide、company-policy）被多个技能钉住。组合技能
（如 grill-with-docs 同时走 grilling 与 domain-modeling）可以共用同一套安装图，
但「一起用」不是安装成功的判据。

权威声明在 Release Manifest `dependencies`；发布时冻结为 Release Dependency
Lock。它与项目侧的 Skill Dependency Manifest（`.skills.json`）分开：后者是
项目直接使用的技能，前者是技能对技能的边。传递依赖进入 Skill Dependency
Lock 与 Skill Store / Tool Link，不进入 `.skills.json`。

## 考虑过的方案

- **SKILL.md / 清单里加运行时 depends，让宿主自动组合加载**：调用组合是真需求，但 Claude/Codex 并不消费该字段；做成 ESL 私有协议等于空规范。
- **只靠 SKILL.md 散文、安装图不管传递技能**：Agent 目录里看不到 B，A 的「请使用 B」会落空；共享基础技能无法随 A 送达。
- **把项目 `.skills.json` 与技能 `release.json.dependencies` 合成一张图**：项目用技能和技能用技能的生命周期不同（一个跟仓库走，一个跟 Release 冻结），混用后 uninstall / 可见性 / 锁语义都会缠在一起。

## 后果

- 补齐发布依赖时，只扩展解析、锁、安装、卸载与可见性；不改 SKILL.md 必填 frontmatter。
- 能依赖谁、钻石冲突、私有依赖、传递依赖回收，见 ADR-0056。
