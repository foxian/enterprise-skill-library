# 跨实例技能源码导出与播种

Status: accepted

同一份基础技能需要交给多家企业的自部署 ESL Server；目标企业各自首次上传后独立维护领域知识。这不是既有 Server-hosted Skill Source 的 Origin 迁移，也不是持续同步或上游跟踪。

## 决策

- 提供 `esl source export [path] [--output <directory>]`，只进行本地操作，不连接 Server；默认输出到源目录同级的 `<短名>-export/`。不用 `.export` 后缀，不创建容易误认成隐藏配置的目录。
- 命令要求技能目录为 Git 仓库根，工作树干净；仅导出 `HEAD` 中已提交的文件（遵循 Git 追踪与忽略规则），不带 `.git`、远端配置和提交历史。已有目标目录或目标在源目录内部时拒绝，原始维护源保持不变。
- 在导出副本中保留 `release.json` 的通用元数据，把 `name` 去掉原 scope，变为裸短名；不在源目录修改身份。目标企业的 Maintainer 应先审查文件，若要归入组织命名空间，在首次上传前把副本 `release.json.name` 改为 `@目标组织/短名`；裸名上传会归入上传者个人命名空间。首次上传时确认身份，之后独立生成 Skill ID。
- 导出并不清洗任意已提交文件中的域名、凭据或私有内容；交付前仍需人工审查。后续改动在目标企业自己的源码仓库进行，无隐式上游合并。

## 不采用

- `git clean`：会删除未跟踪文件，却不移除 `.git`，不生成快照。
- `esl source reset`：就地移除 `esl` remote、备份清单，服务于脱管，不适合跨实例分发。
- 复制整个目录再删 `.git`：容易保留脏工作树与旧身份，且可能破坏原目录。
- `source archive`、`source pack`：分别与服务器 Archived Skill 和 Published Skill Package 混淆。
