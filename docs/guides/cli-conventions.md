# ESL CLI 约定

面向人类日常使用的 CLI 表面约定。Agent / 脚本应继续优先使用长选项（可读、稳定）；短选项是人手快捷面。

## 短选项预算

- **只给高频旗标短选项。** 单字母命名空间很紧，占掉就很难收回。
- **当前白名单：**
  - `-d` / `--debug`（程序级）
  - `-C` / `--cd <path>`（程序级，语义对齐 npm `-C`）
  - `-f` / `--force`（部分会改状态的命令；跳过确认或覆盖 ESL 管理的陈旧 link）
  - `-g` / `--global`（用户级 Skill Store / Tool Links；凡支持 `--global` 的命令均支持 `-g`）
  - `-m` / `--message <text>`（说明文本；`upload` / `publish` / `deprecate` / `notes`）
- **禁止：**
  - 为省事给子命令起前缀缩写别名（如 `un`、`ad`、`inst`）。现有唯一命令别名 `list` → `ls` 维持，不再扩张。
  - 给低频或带值的旗标配短选项（如 `--tools`、`--server`、`--namespace`、`--version`、`--json`）。
  - 给高危 / 罕见的管理员命令配短选项。例如 `release-delete` 的 `--force`（覆盖依赖钉死守卫）**只有长写**，故意不提供 `-f`。
- **新增短选项前先问：** 是否人手高频？是否有稳固的 Unix/npm 肌肉记忆？会不会挤占更重要的字母？

## 文档与示例

- `esl --help` / 子命令 help：长短选项一并展示。
- [usage.md](usage.md)：人类示例优先短写（`-g`、`-m`）。
- `esl-operator` 技能：调用示例保持长写；可在旗标清单中注明短写等价。
