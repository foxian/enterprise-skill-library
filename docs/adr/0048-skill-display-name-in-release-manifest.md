# 技能显示名进入 Release Manifest，对外按最近发布快照解析

Status: accepted

技能需要面向人的短标题（可为中文），与 Skill Identity 的机器短名分离。我们决定在
Release Manifest（`release.json`）增加可选字段 `displayName`，并将
`schemaVersion` 升到 4；对外目录/搜索的当前显示名在「曾发布」时取**最近一次
Skill Release（按发布时间，含预发布）**的快照，在「从未发布」时取 Source Upload
同步的当前源码值，否则回退 Identity 短名。这有意不同于技能描述（描述随每次
upload 更新当前值）。

## 决策

- **概念**：技能显示名是纯展示短标题，不参与身份、授权或安装判定；与技能描述分工为「叫什么」vs「做什么」。单字段可选字符串，允许中文与空格，不要求唯一，不做 locale 映射，也不是中文专用字段（对齐 ADR-0044：用户内容保持原文）。
- **权威源**：`release.json.displayName`（camelCase）。不放进 `SKILL.md` frontmatter，以免与描述并列却又跟发布快照强绑定的语义分裂到两个文件；也不做成仅 DB 字段（团队显示名那种），以便源码、init 与 Release 快照同源。
- **schema**：`schemaVersion` 升至 **4**。v3 清单不含该字段仍合法；带 `displayName` 的清单须为 v4。保留 `.strict()`，避免旧 CLI 把未知键当错误却又无版本信号。
- **init**：生成 v4 清单时写入 Title Case 种子（`markdown-master` → `Markdown Master`）；支持 `--display-name`；交互可改；`--no-input` 静默写种子。不新增专用元数据编辑命令，后续仍手改文件再 upload/publish。
- **当前值解析**（消费面与管理面标题共用同一规则）：
  1. 若存在任意 Skill Release → 取 **发布时间最新** 那一版 `releaseManifest.displayName`；
  2. 否则（`active-unreleased`）→ 取 upload 同步到服务器的当前源码 `displayName`；
  3. 字段缺失或为空 → Identity 短名原文（运行时不做 Title Case）。
- **与描述的不对称**：技能描述仍以 `SKILL.md` 为准、每次 upload 更新「当前描述」。显示名在首次 publish 之后不再被后续脏 upload 改写对外标题，除非再 publish。未发布技能不进入 `esl search`；管理面 inventory 仍可见未发布技能，并可显示 upload 同步的显示名。
- **快照**：每次 publish 将当时的 `release.json`（含 `displayName`、keywords、license 等）固化为该 Release 的元数据；安装包生成物可携带该字段。
- **展示与搜索**：Web/CLI 凡技能标题位优先显示名，Identity 作技术名；搜索在已发布技能上可匹配显示名。`esl list` 仍只列本机已安装副本。

## 考虑过的方案

- **放在 `SKILL.md`，生命周期对齐描述（upload 即改当前值）**：与「展示元数据同居」更直观，但无法单独满足「有发布后误 upload 不脏搜索标题」；且用户明确要求进 `release.json`。
- **对外始终跟最高稳定版**：与默认安装解析一致，但作者要求「有发布就跟最后一次发布（含预发布）」，接受标题来源与默认安装版本可能分叉。
- **无稳定版时回退短名、不读源码名**：规则更硬，但 init/upload 后管理面看不到 Title Case 或中文名，体验差；改为「仅从未发布时用 upload 源码名」。
- **locale 映射或 `displayNameZh`**：与 ADR-0044 的「用户内容不翻译、单原文」不一致，且首版过重。
- **新增 `esl meta`/`edit` 命令**：可延后；本决策不阻塞在编辑 UX 上。

## 后果

- `packages/core` Release Manifest 校验、init、upload（同步未发布当前显示名）、publish（快照）、search/info/Web 列表与 `skills/esl-operator` 文档需随 CLI 契约同步（ADR-0008）。
- 技能表需能存放「当前源码显示名」（供从未发布时展示），与各 Release 快照中的显示名并存；有发布后对外读取走最近 Release，不走该当前值。
- 默认 `install` 仍解析最高稳定版；若最近发布是预发布，列表标题可能来自 beta，而默认安装仍是稳定版——文档与 UI 副文案需可区分 Identity/版本。
