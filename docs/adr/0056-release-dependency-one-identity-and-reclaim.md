# 发布依赖：一份身份、可见性与回收

Status: accepted

发布依赖只指向已发布的 Server-hosted 技能（`@namespace/name` + 已有 Skill
Release），不能指向 `@builtin`、`@local` 或 `file:`。同一 Skill Identity 在一份
安装图里只能有一个版本：发布时（以及本地源按即将发布的规则解析时）多条 SemVer
范围必须有交集，冻结为其中最高满足版本，否则失败；消费端多把已冻的锁对不上时，
取其中更高的版本，前提是它仍满足各方 Release Manifest 里的 range，否则整次安装
失败。根技能的每个消费者必须读得到整条依赖链（Public 根则全链 Public）；发布时
校验发布者可读，安装时校验安装者可读。uninstall / update 回收不再被任何剩余根
的直接依赖或 Release Dependency Lock 需要的传递依赖，并拆掉对应 Tool Link。
本地 `install` / `link` 未冻锁时用当时最高满足版本拉取已发布依赖，真正的锁只在
publish 时冻结。作者用手改 `release.json.dependencies` 或 `esl depend
add|remove|list` 声明边；该命令只改技能源清单，不碰项目 `.skills.json` / Skill
Store，也不自动 version/commit。

## 考虑过的方案

- **无交集仍硬装全局最高，或 Store 并装多版本**：前者让声明和锁撒谎；后者要改
  目录、锁、Tool Link 和 Agent 发现，不是补齐安装图。Skill Store 按 Identity
  只有一份副本，npm 式嵌套多版本搬不过来。
- **两把锁版本必须字面相同，否则安装失败**：共享基础技能几乎无法共存，作者冻到
  不同 patch 就会装不齐。
- **公开技能允许依赖别人装不到的私有技能，或一律禁止 Private 依赖**：前者让目录
  上的技能「看起来能装、其实装不齐」；后者禁止组织内私有 A 依赖同组织私有
  style-guide，主场景被砍掉。
- **卸载留下孤儿，另做 `esl prune`**：多出来的技能会进宿主目录，Agent 可能误触发；
  不要让用户记一次 prune。
- **本地源安装忽略 `release.json.dependencies`**：开发态看不到被依赖技能，作者会
  以为「写了就生效」。
- **`esl depend` 顺便装进 cwd，或做成项目侧 `esl add`**：发布依赖是技能源码的属性，
  与项目用技能分开；命令名必须挂在 `depend` 下，避免和 `install` / `uninstall` 撞车。

## 后果

- 发布解析从「按名字扁平覆盖」改为求交集；无交集或环、或目标没有已发布 Release，
  发布失败。
- 项目同时安装多个根技能时，要对已装版本与新锁做同一套「更高且仍满足各方 range」
  的合并；装不上则整次失败，不留下半套图。
- `esl depend` 与 CLI 契约同步进 `skills/esl-operator/`（ADR-0008）。
