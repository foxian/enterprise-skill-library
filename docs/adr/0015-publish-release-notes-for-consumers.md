# Publish 自动生成版本说明并面向消费者暴露

Status: accepted

版本说明（Release Notes）需要**面向消费者**：安装/升级前让用户看到"这个版本改了什么"，据此决定是否更新本地技能。因此说明必须进 release 记录并经 API 暴露，而不只是存在于 git。同时遵循「不强制填、但每次都有」的原则——从 commit 自动提炼，用户只负责确认。

具体决策如下：

- **publish 解析版本说明**：`--message` 显式指定；否则自动收集"自上一个 release tag（`git describe --tags --abbrev=0`）以来的 commit message"作为默认说明；交互时展示收集结果并允许确认/修改（直接回车用默认）；非交互（`--force`/`--no-input`）直接用收集结果。收集失败（无 tag、git 异常）则说明为空。
- **双落点存储**：
  1. **release 记录（DB）**：`skill_releases` 新增 `notes` 列，publish 时写入；GET skill 的 `releases` 数组随之带 `notes`，供 `esl info`、升级检查等消费者链路消费。
  2. **release tag message（git）**：`v<version>` annotated tag 的 message 用版本说明（无说明时回退到原 `Release @scope/name version`）。
- **删除随技能级联**：`esl delete` 的 `deleteSkill` 已级联删除 `skill_releases` 整行（含 notes）。

## Considered Options

- **强制填写**：说明书有了但 friction 高、破坏 CI，被弃（见 ADR-0013 同款论证）。
- **只存 git tag**：无法经 API 暴露给消费者，被弃——消费者判断升级需要的是 API 可读的说明。
- **自动 changelog 文件**（CHANGELOG.md 入源码）：与"源码只放发布属性、不放生成物"（ADR-0010）冲突，被弃。

## Consequences

- 每次 publish 几乎总有版本说明（自动收集，零负担），且消费者可通过 API 读取。
- `esl info` / 升级提示的"新版本改了什么"展示是消费端的下一步（API 已就绪）。
- 需要服务端重建（schema 变更 `notes` 列有 ensureColumn 迁移）。
