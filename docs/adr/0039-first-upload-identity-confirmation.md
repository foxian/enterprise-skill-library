# 首次上传身份确认与已托管源 Namespace 防漂移

Status: accepted（细化 ADR-0032 的首次 Source Upload 身份固定契约）

首次 Source Upload 会创建不可复用的 Skill ID、服务器 Git 仓库与既定 Skill Identity，因此归属选择必须在创建前被明确确认。`esl init` 生成新的 Release Manifest 时询问 namespace：默认 `personal` 并写入裸短名；交互式界面优先展示编号列表（必要时向服务端读取一次用户所在组织，失败回退本地缓存或手输），组织归属也可通过 `--namespace <组织名>` 写入 `@组织名/短名`。CLI 不再根据当前登录用户自动把裸短名展开成 `@用户名/短名`，避免把「个人命名空间的机械表示」误写成依赖当前登录态的持久声明。

首次 `esl upload` 在交互式终端显示完整技能身份并要求 `y/N` 确认；非交互模式必须传 `--confirm-identity <release.json.name>`，且值须完全一致。对已有 `esl` remote 的已托管源，后续 `upload` 在 fetch/rebase/push 前比对 Release Manifest 声明的 namespace 与 remote 揭示的既有 namespace；不一致即阻断。`esl whoami` 保留组织成员关系展示，但输出标签改为 `Organization memberships:`，明确它不是当前组织上下文。

## Considered Options

- **首次上传不额外确认，继续依赖 `release.json.name`**：单字段权威没错，但一次清单笔误就会烧掉一个身份；该动作不可逆且低频，值得一次显式确认，故弃。
- **确认时只问组织名或只问短名**：两者拼起来才是身份；拆开确认仍可能掩盖完整归属的错误，故弃。
- **允许已托管源通过修改 `release.json` 迁移 namespace**：会把治理级跨命名空间迁移混入日常源码同步，且会破坏授权、可见性与历史身份的稳定性，故弃。
- **把裸名自动展开为当前用户的完整身份写回清单**：清单会依赖当时的登录用户，换账号后语义漂移；裸名本身已经明确定义为个人命名空间，故弃。

## Consequences

- 脚本与 CI 中的首次上传必须显式传 `--confirm-identity`；交互式用户得到一个可拒绝的 `y/N` 停靠点。
- 已托管源只允许在原 namespace 内继续同步；短名变更仍走 `esl rename`，客户端按短名防线拦截。
- 裸名在已托管源校验时由当前登录用户解析个人 namespace；无法解析登录用户时阻断而非猜测。
- 想使用其他归属，必须恢复原 namespace 继续维护旧源，或显式创建一个新源；v1 不提供跨 namespace 迁移命令。
