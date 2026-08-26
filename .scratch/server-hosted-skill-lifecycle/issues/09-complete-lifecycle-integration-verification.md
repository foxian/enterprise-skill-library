# 09 — Complete Lifecycle Integration Verification

**What to build:** 用两个普通 Skill User 在 Docker 运行环境中验收从 Source Upload 到 Source Update、Skill Release、Package Install、Update、Rename、Archive 和 Restore 的完整生命周期。

**Blocked by:** 03 — Skill Release 与 Published Skill Package；05 — Release Update 与依赖版本锁定；07 — Rename-aware Update Migration；08 — Archived Skill Governance

**Status:** ready-for-agent

- [ ] fresh volume Bootstrap 创建唯一 Platform Organization 和管理员状态。
- [ ] 作者 upload 后获得 Skill ID，消费者可以 source 未发布源码但不能 push 或 install。
- [ ] 作者 push 源码后发布至少两个 Release，消费者能安装 Published Skill Package 并 update 到新 Release。
- [ ] 源码新提交不会改变既有 Published Skill Package，固定旧 Release 可复现。
- [ ] rename 后消费者通过 update 完成本地目录、依赖键、lockfile 和适配输出迁移。
- [ ] archive 后搜索、source、push、publish 行为符合生命周期规则，restore 后管理员可恢复。
- [ ] 容器重启后 Skill ID、Git 仓库、Release、Package bytes、依赖锁和重定向保持一致。
- [ ] smoke 验收通过后运行完整 `npm test` 和 `npm run build`。
