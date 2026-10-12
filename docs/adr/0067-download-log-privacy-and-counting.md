# 下载日志的隐私边界与下载量计数口径

- Status: Accepted
- Date: 2026-10-12

## 决策

每次成功获取 Published Skill Package 时，ESL Server 记录一条下载日志；技能的下载量按获取事件跨版本累加，公开展示。下载日志的 IP 字段截断存储：IPv4 保留 /24 段、IPv6 保留 /48 段，不存全量 IP。明细日志保留 90 天，过期后仅保留聚合计数（聚合计数永久保留）。明细日志仅 Super Administrator 可查询。

## 理由与取舍

截断 IP 是对审计精度与隐私合规的权衡：全量 IP 可精确溯源，但属于可识别个人的数据，存储伴随合规义务；/24、/48 段足以支撑来源与网络层面的分析，且不可还原到个人。未来工程师看到截断的 IP 不应视为缺陷去"修复"为全量存储——口径一旦放宽，已收集的数据无法事后"未收集"。

计数采用 npm 式口径：每次成功获取计一次，不去重。install、update、重装与依赖解析拉取均构成一次下载，被依赖技能的下载量随根技能安装同步增长。该口径是公开指标的历史可比性基准，改动口径会使历史数字失去可比性；若未来要改按账号去重的"唯一用户数"，应作为新指标并行提供，而不是替换下载量。

## 已确定的记录内容

- 核心字段：Skill ID（含 Skill Identity 冗余）、实际安装 version、请求的 version specifier。
- 下载人：user_id 与 username；未认证场景为空。
- 来源：截断 IP 段（IPv4 /24、IPv6 /48）。
- 客户端环境：`os_platform`、`os_arch`、`esl_version`、`node_version`（从 User-Agent 解析后分字段落库），不存完整操作系统版本——精确到内核 build 号属设备指纹级信息，兼容性分析只需 platform 与 arch。
- 时间与结果：downloaded_at（UTC）、result（success/failure）、failure_reason（失败时的错误类型）。
- 聚合计数独立于明细日志：技能总下载量（跨版本）、各版本下载量、近 30 天下载量。

## 已确定的可见面

- 下载量（跨版本汇总的总次数）公开展示：Web 可安装技能发现的技能卡片、技能详情页、CLI 搜索结果。
- 明细日志仅 Super Administrator 可查；技能 Owner 侧的统计需求由聚合数字满足，第一版不向 Owner 开放明细（含用户名与 IP 段的行为画像最小可见面）。
- 内置技能（Built-in Skill）与本地技能不经服务器获取包，不产生下载日志。

## 术语

下载日志（Download Log）与下载量（Download Count）的定义见根 `CONTEXT.md`。
