# Source Remote 重指：Server Origin 迁移后 upload 自动修复源地址

Status: accepted

ESL Server 的用户可见 origin（Single User-Facing Server URL，ADR-0004）在整体迁移
（Registry 与 Git Backend 数据原样搬迁，Skill ID、Skill Identity、Git 仓库路径与
Skill Release 全部不变）后变化时，已有 Server-hosted Skill Source 目录中的
Source Remote 仍指向旧 origin：`config set-server` 只改配置，不触碰任何已存在的
remote，而 Source Remote 的 URL 在首次 Source Upload 时即固化。后果有三：
`upload` 对失效地址 fetch/push 失败，且错误被 ADR-0021 的「账号/权限」语义误读；
`status` 静默降级为按上次本地同步显示 ahead/behind，无声过期；`publish` 虽因数据
整体迁移而仍能成功，但用户不知道目录携带失效 origin。我们决定引入
**Source Remote 重指**：`upload` 检测到 Source Remote origin 与当前配置的 ESL
Server origin 不一致时，先以旧 remote 路径解析出的 Skill Identity 向当前 ESL
Server 验证（技能可解析，含 Skill Rename 重定向），验证通过则采用服务器返回的
cloneUrl（ADR-0004：客户端不自行推导后端路径）静默重指并继续正常 upload 流程，
输出一行提示；验证不通过时维持 ADR-0021 的可行动错误。`status` 检测到漂移时
只读提示，不修改任何配置；`publish` 不加检测。

## Considered Options

- **现状 + 迁移文档（手动 `git remote set-url`）**：保留误导性错误与 status 的
  静默过期；把 git remote 细节强加给用户。放弃。
- **仅引导（打印修复命令，用户自执行）**：保守可行，但用户仍需理解 git remote
  概念；其「准确报错」部分被采纳为验证失败时的回退路径。整体放弃。
- **本地目录注册表 + `set-server` 批量重映射**：引入可被目录移动/复制破坏的持久
  状态（与 ADR-0021 否决「记住每目录账号」同理），且 `set-server` 时刻本就无法
  枚举既有源目录（全盘扫描不现实）。放弃；重指改为在使用现场发生，零持久状态。
- **重指前交互确认**：验证已保证逻辑源一致，最坏结果是 push 失败——无数据损失、
  无所有权变化；确认步骤在 CI/脚本下徒增人工介入。放弃，改为静默重指 + 一行提示。
- **运维侧旧域名反代/重定向**：仅域名变更且旧域名保留时可行，IP 变化即失效；
  写入迁移文档作为可选兜底，不作为产品行为依赖。

## Consequences

- Server Origin 迁移后，已托管源目录在下次 `esl upload` 时自动恢复，全程无需
  用户了解 git remote 细节；`status` 不再无声装傻（漂移以只读提示可见）。
- 重指不改变所有权：push 仍要求当前登录在新 ESL Server 具备维护者权限；不可访问
  时行为与 ADR-0021 一致，且错误信息须区分「地址迁移未通过验证」与「账号/权限」
  两种情形，替代现状的单一误导文案。
- 与 ADR-0021 的边界：ADR-0021 禁止的是鉴权失败触发的接管/重新注册；重指不创建
  Skill ID、不删除 Source Remote，验证失败也不回退到 orphan 重新注册路径。
- 依赖当前登录能读取该技能元数据完成验证；读不到时按「不可验证」处理，走可行动
  错误，不盲改。
- 术语入册：Server Origin 迁移、Source Remote 重指（见 CONTEXT.md）。
- 实现时须同步更新 `skills/esl-operator/`（`SKILL.md` 与 `references/`），保持
  与 CLI 行为一致（ADR-0008 客户端耦合契约）。
