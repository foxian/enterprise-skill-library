# 不使用 Git 的技能协同编辑与发布方案

## 结论

可以不使用 Git，但需要把能力拆成四层：

1. 协同编辑：多人修改文件或页面。
2. 版本与审阅：历史版本、评论、审批、回滚。
3. 权限与审计：用户/组权限、发布权限、操作日志。
4. 发布链路：校验批准版本后上传到生产服务器。

对于技能库，编辑区不应直接等同于生产目录。推荐流程：

```text
编辑区 -> 审阅区 -> 批准版本 -> 自动校验 -> 构建发布包 -> 生产服务器
```

## 方案比较

| 方案 | 协作方式 | 冲突处理 | 审阅与审计 | 发布方式 | 适用性 |
|---|---|---|---|---|---|
| Nextcloud + WebDAV | 网页、桌面同步客户端、WebDAV | 文件锁、历史版本恢复；文本语义合并需编辑器支持 | 分享、活动记录、可选管理员审计 | 发布脚本从批准目录导出到服务器 | 自托管且需要保留技能目录结构 |
| SharePoint/OneDrive | Office 实时协作；其他文件可签出/签入 | Office 协同或文件签出；Markdown/YAML 更适合单文件责任人 | Microsoft 365 权限、版本控制、审批和 Purview 审计 | Microsoft Graph 拉取批准版本，再构建发布 | 已有 Microsoft 365 的企业 |
| 对象存储 + 管理后台 | 后台实现编辑器、评论和工作流 | 后台实现租约、哈希/版本检查、差异和合并 | 后台 RBAC 与自定义审计 | 上传事件触发校验、构建和发布 | 技能文件需要机器消费、发布门禁严格 |
| Wiki/知识库 | 页面实时编辑、评论、版本历史 | 页面协同编辑器处理 | 空间/页面权限、审批、审计 | Wiki 直接作为阅读发布站，或 API 导出 | 知识文章和规范为主 |
| Syncthing/rsync | 多设备目录同步 | 产生冲突副本，不做 Markdown 语义合并 | 权限、审批、审计能力弱 | 同步到接收节点，再由脚本校验发布 | 只需要低成本传输，不适合作为完整协作系统 |

## 关键事实与来源

### Nextcloud + WebDAV

Nextcloud 官方文档说明其完整支持 WebDAV，可通过 WebDAV 创建、读取和编辑远程文件，也可以使用官方客户端同步到本地目录。[Nextcloud WebDAV 文档](https://docs.nextcloud.com/server/stable/user_manual/en/files/access_webdav.html)

Nextcloud 的版本控制会保留文件历史，并支持恢复任意历史版本；旧版本会按策略过期。[Nextcloud 版本控制文档](https://docs.nextcloud.com/server/stable/user_manual/en/files/version_control.html)

这适合“一个人编辑、其他人审阅”的文件型工作流。Markdown、JSON、YAML 的行级合并不能只依赖文件存储层，需要额外编辑器或明确的文件锁策略。

### SharePoint/OneDrive

Microsoft Graph 的 `driveItem checkout` 可以签出文件，阻止其他人编辑，并使修改在签入前对其他用户不可见。[Microsoft Graph checkout 文档](https://learn.microsoft.com/en-us/graph/api/driveitem-checkout?view=graph-rest-1.0)

因此可以让 SharePoint 负责身份、权限、版本和审批，再由发布服务通过 Graph 读取已批准文件。对技能目录中的多个文件，建议按“变更集”或压缩包提交，避免部分文件已更新、部分文件未更新。

### 对象存储

以 Amazon S3 为例，启用版本控制后，同一个对象可以保留多个版本，覆盖和删除都可以恢复；但每个版本按完整对象计费，而不是只保存差异。[S3 Versioning 文档](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)

对象存储不是协同编辑器。管理后台必须自行实现：

- 编辑锁或租约；
- 保存时校验用户看到的版本号或内容哈希；
- 冲突时拒绝覆盖，要求重新加载和比较；
- Markdown 等文本的差异/三方合并；
- 审阅、批准和发布审计。

它最适合技能包需要被程序加载，并且生产发布必须经过结构校验、安全扫描和不可变构建的场景。

### Wiki/知识库

Confluence Live Docs 支持多人实时协作；Confluence 还提供页面内容组织、评论、状态和审批等文档工作流能力。[Confluence Live Docs 文档](https://support.atlassian.com/confluence-cloud/docs/create-and-collaborate-in-real-time-with-live-docs/)

Wiki 更适合作为规范、操作手册和评审记录的发布面，不适合作为需要原样部署的技能目录源仓库。若生产端必须得到 Markdown/YAML/JSON 文件，需要额外的 API 导出服务。

### Syncthing

Syncthing 会对文件分块并校验哈希；当两个设备同时修改同一文件且内容不同，会把其中一个重命名为 `.sync-conflict-*` 冲突副本，而不会理解 Markdown、JSON 或 YAML 的语义。[Syncthing 同步机制文档](https://docs.syncthing.net/users/syncing.html)

所以它可以作为传输层：服务器使用接收模式接收文件，发布脚本先检测冲突文件和技能结构，再原子切换生产目录。但它本身不提供完整的审阅、审批和合规审计。

## 针对本项目的建议

### 首选：Nextcloud + 发布脚本

如果目标是少开发、保留当前 `skills/` 目录结构并允许团队通过网页或本地文件操作，建议：

1. Nextcloud 保存编辑区和审阅区。
2. 通过文件锁或“单文件责任人”避免同时修改同一 Markdown 文件。
3. 审阅通过后复制到批准区。
4. 发布服务导出批准区，运行技能结构校验、Markdown/YAML 检查和安全扫描。
5. 校验通过后上传到服务器临时目录，完成后原子替换生产版本。

### 企业已有 Microsoft 365：SharePoint + Graph

如果组织已有 Microsoft 365 身份和审计体系，SharePoint 的权限、签出/签入、版本和审批可以减少自建管理功能。但 Markdown 技能目录的编辑体验不如 Nextcloud，发布服务仍需自行开发。

### 长期产品化：对象存储 + 管理后台

如果希望把技能协作做成产品，并需要按技能包审批、自动测试、发布记录、回滚和多环境部署，建议使用对象存储作为不可变版本仓库，管理后台负责工作流，发布服务负责构建和部署。这条路线控制力最高，但开发量也最大。

## 不建议

不要只用 Syncthing、rsync、SFTP 或普通共享目录直接覆盖生产服务器。它们能解决“文件到了服务器”，但不能可靠解决“谁改了什么、是否审阅、是否冲突、能否回滚、是否通过校验”。
