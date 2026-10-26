# 技能路径规范

路径错误会同时出现在文档引用、脚本实现和命令示例三层；操作系统、shell、安装位置和执行目录都会影响解析，只靠“用正斜杠”一条规则覆盖不了。本文把路径问题拆成五类“根/目录”，分别给出取法和检查项。

## 目录

- 先分清五个“根/目录”
- 技能内资源：相对技能根目录
- 项目根目录：不要假设 cwd
- 输出与用户数据
- 命令写法
- 正反例
- 路径专项检查

---

## 先分清五个“根/目录”

| 名称 | 含义 | 取法 |
|---|---|---|
| 技能根目录 | 包含该技能 `SKILL.md` 的目录 | 文档/命令写 `<技能根目录>` 占位符；脚本内用 `Path(__file__).resolve().parent.parent`。`${CLAUDE_SKILL_DIR}` 仅 Claude Code 提供 |
| 会话项目根 | 宿主认定的项目目录（monorepo 中可能是子包） | 显式参数 → `CLAUDE_PROJECT_DIR`（Claude 生态可选） → 工程标记 → cwd 兜底 |
| VCS 仓库根 | Git 仓库顶层目录 | `git rev-parse --show-toplevel` |
| 用户数据/输出目录 | 下载、导出、报告等落盘位置 | 由用户传入；示例写 `<下载目录>`、`<输出目录>` |
| 工具路径 | `python`、`ffmpeg`、`aria2c` 等外部命令 | 要求位于 `PATH`，不写某台机器的绝对路径 |

**技能根 ≠ 项目根。** 技能根只用于找技能自带的 `scripts/`、`references/`、`assets/`；项目根用于读写用户的工程文件。混淆二者是技能最常见的路径错误。

## 技能内资源：相对技能根目录

- 文档引用一律以技能根目录为基准、保持一层深：`references/...`、`scripts/...`。引用深度规则见 [authoring.md](authoring.md) 的“结构与引用深度”。
- 全部使用正斜杠，包括面向 Windows 的说明。
- 执行命令不确定当前目录时，示例统一写 `<技能根目录>/scripts/x.py`，由使用者替换成绝对路径。`${CLAUDE_SKILL_DIR}/scripts/x.py` **只在 Claude Code 中保证可用**（且主要面向其 bash 注入命令），其他宿主不保证；跨宿主的技能不要依赖它。
- 脚本内部定位自身资源用 `Path(__file__).resolve().parent`，不要按 cwd 拼路径：

```python
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent  # scripts/ 的上一级
REFERENCE = SKILL_ROOT / "references" / "sites" / "example.md"
```

- 反例：`scripts\x.py`、`..\..\scripts\x.py`、`D:\tools\skill\scripts\x.py`。

## 项目根目录：不要假设 cwd

`cwd` 会跟着执行过程变化：Bash 里的 `cd` 延续到后续命令，子代理不继承 cwd 变更，越界时宿主还会把目录重置到项目目录。因此 **cwd 不是稳定的项目根**，只能作兜底。需要项目根时按固定优先级解析：

1. **用户显式传入的项目路径**：解析为绝对路径，校验存在且是目录。
2. **宿主环境变量**：`CLAUDE_PROJECT_DIR` 存在时使用它。
3. **Git 仓库根**：`git rev-parse --show-toplevel`（失败时静默进入下一步）。
4. **工程标记**：从起点逐级向上查找 `.git`、`pyproject.toml`、`package.json`、`Cargo.toml`、`go.mod`、`AGENTS.md`。
5. **cwd 兜底**：以上都失败才回退当前目录，并在日志中写明“回退到当前目录”。

注意：

- `CLAUDE_PROJECT_DIR` 是**会话启动根**，在 monorepo 里可能指向子包；明确需要仓库根时改用 Git，不要拿它代替。
- 该变量并非所有宿主都提供（官方主要在 hooks 场景说明），所以它只能作为可选项，不能硬性依赖。
- 解析后必须校验“存在且是目录”，失败就报错停止，不要继续猜路径。
- 把最终解析结果打印/写入日志，后续所有相对路径都基于这个绝对根。

Python 参考实现：

```python
import os
import subprocess
from pathlib import Path

MARKERS = (".git", "pyproject.toml", "package.json", "Cargo.toml", "go.mod", "AGENTS.md")


def resolve_project_root(explicit: str | None, start: Path) -> Path:
    if explicit:
        root = Path(explicit).expanduser().resolve()
    elif os.environ.get("CLAUDE_PROJECT_DIR"):
        root = Path(os.environ["CLAUDE_PROJECT_DIR"]).resolve()
    else:
        try:
            out = subprocess.check_output(
                ["git", "rev-parse", "--show-toplevel"],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
            root = Path(out).resolve()
        except (OSError, subprocess.CalledProcessError):
            base = start.resolve()
            root = next(
                (p for p in [base, *base.parents] if any((p / m).exists() for m in MARKERS)),
                base,
            )
    if not root.is_dir():
        raise SystemExit(f"项目根不存在或不是目录: {root}")
    return root
```

Shell 简写仅适用于 POSIX shell；Windows 的 PowerShell 请写等价逻辑，不要照抄：

```bash
PROJECT_ROOT="${1:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
```

## 输出与用户数据

- 示例统一使用 `<下载目录>`、`<输出目录>`，运行时替换为用户给定的绝对路径。
- 落盘前先 `resolve()`：`out`、`job`、`--root` 等参数都要转成绝对路径。
- 示例里不要写 `downloads/xxx`、`./output/report.md` 这类依赖 cwd 的相对输出路径。
- 缓存、状态文件名基于项目绝对路径的哈希，而不是相对目录名，避免不同项目互相覆盖。

## 命令写法

- 每条示例命令写单行；不要用 cmd 的 `^` 或 PowerShell 反引号续行，跨 shell 会失效。
- 含中文文件名、`&`、空格或复杂引号时，把参数放进 JSON/配置文件，不要裸拼 shell 字符串。
- 外部工具按名字调用（`python`、`ffmpeg`），并在文档中声明为 PATH 依赖。

## 正反例

| 场景 | 反例 | 正例 |
|---|---|---|
| 文档引用脚本 | `scripts\make_job.py` | `scripts/make_job.py` |
| 脚本引用上级资源 | `..\..\scripts\x.py` | `Path(__file__).resolve().parent.parent / "scripts" / "x.py"` |
| 个人机器路径 | `D:\DevProjects\my-skill\scripts\x.py` | `<技能根目录>/scripts/x.py` |
| 命令续行 | cmd 用 `^` 分行 | 单行命令 |
| 输出目录 | `--root downloads` | `--root <下载目录>` |
| 脚本定位项目 | `Path.cwd() / "data"` | `resolve_project_root(args.project, Path.cwd())` |
| 技能根当项目根 | `Path(__file__).parent / "src"` 找用户代码 | 技能资源用 `__file__`，用户工程用项目根 |
| 会话根当仓库根 | 直接信任 `CLAUDE_PROJECT_DIR` 做仓库级操作 | 仓库级操作走 `git rev-parse --show-toplevel` |

## 路径专项检查

- [ ] 技能内引用能从技能根目录解析
- [ ] 没有反斜杠路径
- [ ] 没有个人机器绝对路径（`/home/...`、`~/...`、`C:\Users\...`）
- [ ] 项目根按固定优先级解析，且校验存在
- [ ] 示例命令单行、跨 shell 可用
- [ ] 输出目录使用占位符并在脚本内 `resolve()`
- [ ] 脚本可从任意 cwd 运行
