# 05 — `esl deprecate`：标记不推荐的 Release

**What to build:** 借 npm deprecate，为「不可变 + 单版本不可删」的发布模型补上劝退手段：坏版本（安全缺陷、内容错误）仍可追溯，但消费时得到明确警告。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `skill_releases` 增加 deprecated 标记与劝退说明字段（迁移脚本随之更新）。
- [ ] 新增端点标记 / 解除标记单个 Release，权限与发布一致（Manage Permission）。
- [ ] CLI 新增 `esl deprecate <skill-name> <version> --message <说明>`；传空 message 解除标记。
- [ ] `install` 与解析命中已弃用版本时打印警告（含劝退说明），**不阻止安装**。
- [ ] 已弃用状态**不影响**最新版推导（最高稳定 SemVer 规则不受影响，见 04）。
- [ ] 已归档技能不可标记；操作写入审计记录。
- [ ] 测试覆盖：标记、解除、安装警告、权限拒绝、最新版推导不受影响。
