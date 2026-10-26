# 技能写作工艺指南

起草与打磨 SKILL.md 时的写作规范。skill-forge 主文档负责"创建 → 评测 → 迭代"的流程，本文件负责"怎么把技能本身写好"。发布前请过一遍文末的检查清单。

## 目录

- 精简原则
- 自由度校准
- 命名规范
- description 写作
- 结构与引用深度
- 工作流模式（清单 / 反馈循环 / 条件分支）
- 模板与示例
- 脚本编写规范
- 内容卫生
- 路径规范（见 paths.md）
- 评测先行
- 跨模型测试
- 发布前检查清单

---

## 精简原则

上下文窗口是公共资源。技能与系统提示词、对话历史、其他技能的元数据、用户的实际请求共享同一个窗口。启动时只预加载所有技能的元数据（name + description）；SKILL.md 在技能触发时才进入上下文，参考文件按需读取。但一旦加载，每个 token 都在与其他内容竞争——所以 SKILL.md 的精简依然重要。

**默认假设：模型已经相当聪明。** 只写模型不知道的内容。起草时对每一段信息自问：

- 模型真的需要这段解释吗？
- 能否假设模型已经懂这件事？
- 这段话值它的 token 成本吗？

**好例子（精简，约 50 token）：**

````markdown
## 提取 PDF 文本

用 pdfplumber 提取文本：

```python
import pdfplumber

with pdfplumber.open("file.pdf") as pdf:
    text = pdf.pages[0].extract_text()
```
````

**坏例子（冗长，约 150 token）：**

```markdown
## 提取 PDF 文本

PDF（便携式文档格式）是一种常见的文件格式，包含文本、图片等内容。要提取 PDF
中的文本，你需要使用一个库。可用的 PDF 处理库有很多，但我们推荐 pdfplumber，
因为它易于使用且能处理大多数场景。首先，你需要用 pip 安装它。然后……
```

精简版假设模型知道 PDF 是什么、库怎么用。

## 自由度校准

按任务的脆弱程度和变化空间，匹配指令的具体程度：

| 自由度 | 形式 | 适用场景 |
|---|---|---|
| 高 | 启发式文本指令 | 多种做法都成立，取决于上下文，靠经验法则指引 |
| 中 | 模板 / 带参数的伪代码 | 存在首选模式，允许变体，配置影响行为 |
| 低 | 精确命令，明示"不得修改或追加参数" | 操作脆弱易错，一致性关键，必须按特定顺序执行 |

类比：模型是在探路的机器人——

- **悬崖间的窄桥**：只有一条安全路径。给精确的护栏和指令（低自由度）。例：必须按固定顺序执行的数据库迁移。
- **无障碍的开阔地**：多条路都能到。给个大方向，相信模型自己找到好路线（高自由度）。例：代码评审，最佳做法取决于具体上下文。

注意：低自由度不等于僵化措辞。即使是"必须精确执行"的指令，也解释一下偏离会出什么事（"这个命令会跳过校验直接写入，改动参数可能造成数据损坏"），模型在边界情况下才不会自作聪明。这与主文档"解释原因而非堆砌 MUST"的写作风格一致。

## 命名规范

- **同一技能库内保持一致的命名模式**，让技能易于引用、检索和讨论。
- 名字应描述技能提供的**活动或能力**。动名词形式（processing-pdfs、testing-code）和名词短语（pdf-processing、spreadsheet-analysis）、动词形式（process-pdfs）都可接受，选一种风格用到底。
- **避免**模糊名：`helper`、`utils`、`tools`；过于泛化：`documents`、`data`、`files`。
- **候选应有实际区别**：新建技能的候选名应体现不同的能力表达或范围侧重点，每个说明理由，推荐项说明比较优势；不要只调换单词或堆砌近义词。名称不能暗示技能不具备的能力。
- **标识符格式**：本技能配套校验器要求仅使用小写字母、数字和连字符，最长 64 个字符；不能以连字符开头或结尾，也不能出现连续连字符。拟定和接受名称时使用非空标识符。
- **名称保持一致**：新技能目录名、SKILL.md frontmatter 的 `name` 和打包名使用同一标识符。中文展示标题可以另设，但不能替代标识符。更新已有技能保留原名。
- 各工具对 `name` 字段可能还有额外约束（如保留字），发布前查目标工具的规范。命名确认及冲突处理按 SKILL.md 的“命名与确认”流程执行。

## description 写作

description 是技能被发现的主要机制——模型可能要从 100+ 个技能里选，你的描述必须提供足够信息让它知道何时选你。

**始终用第三人称。** 描述会被注入系统提示词，视角不一致会损害触发。

- 好："Processes Excel files and generates reports"
- 坏："I can help you process Excel files"
- 坏："You can use this to process Excel files"

**具体，且包含关键触发词。** "做什么"和"何时用"两要素都要有：

```yaml
# PDF 处理技能
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
```

```yaml
# Excel 分析技能
description: Analyze Excel spreadsheets, create pivot tables, generate charts. Use when analyzing Excel files, spreadsheets, tabular data, or .xlsx files.
```

```yaml
# Git 提交助手
description: Generate descriptive commit messages by analyzing git diffs. Use when the user asks for help writing commit messages or reviewing staged changes.
```

避免这类空泛描述：`Helps with documents`、`Processes data`、`Does stuff with files`。

多数工具对 description 有长度上限（常见 1024 字符），超长会被截断。skill-forge 的描述优化器（run_loop.py）会自动执行这个约束并按触发率挑选最优描述；配合"模型普遍触发不足，描述要写得强势一点"的经验使用。

## 结构与引用深度

**引用保持一层深。** 所有参考文件都应从 SKILL.md 直接链接。链式嵌套（SKILL.md → advanced.md → details.md）会让模型用部分读取（如 `head -100`）去预览嵌套文件，拿到不完整的信息。

坏：

```markdown
# SKILL.md
See [advanced.md](advanced.md)...
# advanced.md
See [details.md](details.md)...
# details.md
真正的信息在这里...
```

好：

```markdown
# SKILL.md
**基础用法**：（正文直接写）
**高级特性**：见 [advanced.md](advanced.md)
**API 参考**：见 [reference.md](reference.md)
**示例**：见 [examples.md](examples.md)
```

其他结构规则：

- 参考文件超过 100 行时，在文件开头放目录，让模型预览时也能看到全貌
- 文件名要描述性：`form_validation_rules.md`，不要 `doc2.md`
- 目录按领域组织：`reference/finance.md`、`reference/sales.md`，不要 `docs/file1.md`、`docs/file2.md`
- 放心打包大而全的资源（完整 API 文档、大量示例、数据集）——不读取就不消耗上下文

路径解析规则（技能根、项目根、输出占位符）见 [paths.md](paths.md)。

## 工作流模式

复杂任务拆成清晰的顺序步骤。三种常用模式：

### 清单模式

多步骤流程提供一个可复制的进度清单，模型复制进回复逐项勾选，防止跳过关键步骤：

````markdown
## PDF 表单填写工作流

复制这份清单并逐项勾选：

```
任务进度：
- [ ] 第 1 步：分析表单（运行 analyze_form.py）
- [ ] 第 2 步：创建字段映射（编辑 fields.json）
- [ ] 第 3 步：校验映射（运行 validate_fields.py）
- [ ] 第 4 步：填写表单（运行 fill_form.py）
- [ ] 第 5 步：验证输出（运行 verify_output.py）
```

**第 1 步：分析表单**
运行：`python scripts/analyze_form.py input.pdf`
……
````

### 反馈循环模式

运行验证器 → 修复错误 → 重跑，直到通过才继续。这能显著提升输出质量。无代码的技能同样适用——用参考文档当验证器（"对照 STYLE_GUIDE.md 的清单自查，发现问题就修订后重新自查"），有代码的技能用校验脚本。

### 条件分支模式

在决策点明确分叉：

```markdown
## 文档修改工作流

1. 判断修改类型：
   **新建内容？** → 走下方"创建工作流"
   **编辑现有内容？** → 走下方"编辑工作流"
2. 创建工作流：用 docx-js 从零构建，导出 .docx
3. 编辑工作流：解包现有文档，直接改 XML，每次改动后校验，完成后重打包
```

工作流变得庞大时，拆成独立文件，在 SKILL.md 里按任务类型指引模型读对应文件。

## 模板与示例

**模板模式**——按严格程度分两档：

严格（API 响应、数据格式等不容变通的场景）：

```markdown
## 报告结构
务必使用这个精确模板：
# [标题]
## 执行摘要
## 关键发现
## 建议
```

弹性（允许因地制宜时，给默认格式并授权判断）：

```markdown
## 报告结构
以下是合理的默认格式，可根据分析内容自行调整：
# [标题]
## 执行摘要
## 关键发现（按实际发现增删章节）
## 建议
```

**示例模式**——输出质量依赖"见过样子"的技能，提供输入/输出对（3 个左右），比描述更能传达期望的风格和详细程度。注意：示例里出现"输入/输出"字样时，主文档提示过措辞可能需要变通。

## 脚本编写规范

技能包含 `scripts/` 时适用。

### Solve, don't punt

错误在脚本内处理，而不是抛给模型现场想办法：

```python
# 好：明确处理
def process_file(path):
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        print(f"File {path} not found, creating default")
        with open(path, "w") as f:
            f.write("")
        return ""
```

```python
# 坏：直接失败，让模型自己收拾
def process_file(path):
    return open(path).read()
```

### 常量要自证

每个配置值写明取值理由，避免 voodoo 常量：

```python
# HTTP 请求通常 30 秒内完成；放宽以容忍慢连接
REQUEST_TIMEOUT = 30
# 3 次重试在可靠性与速度间平衡；多数瞬时故障第二次就恢复
MAX_RETRIES = 3
```

坏例子：`TIMEOUT = 47  # 为什么是 47？`。你自己都不知道合理值的话，模型更猜不出来。

### 明确"执行"还是"当参考读"

- **执行**（多数情况，更可靠更省 token）："运行 `analyze_form.py` 提取字段"
- **读参考**（复杂逻辑需要模型理解时）："字段提取算法见 `analyze_form.py`"

### 可验证的中间产物

复杂、开放式的批量任务用 plan → validate → execute 模式：先让模型生成结构化的计划文件（如 `changes.json`），用脚本校验通过后再执行。适用于批量操作、破坏性改动、高风险操作。校验脚本的报错要具体（"Field 'signature_date' not found. Available fields: customer_name, order_total, ..."），帮模型直接定位修复点。

### 其他规则

- **优先打包脚本而非让模型现场写**：更可靠、省 token、省时间、跨多次使用保持一致。skill-forge 的"重复工作检测"（多个测试用例都在重复写同类脚本时）正是发现该打包什么的信号
- **声明依赖**：需要安装的包在 SKILL.md 里写明安装命令，不要假设已装好
- **视觉分析**：输入可渲染成图像时（表单布局、图表），先转图再让模型看图分析
- **不假设 cwd 是项目根**：需要项目根时按 [paths.md](paths.md) 的优先级解析（显式参数 → `CLAUDE_PROJECT_DIR` → Git 根 → 工程标记 → cwd），并在日志中打印结果

## 内容卫生

- **避免时效性信息**。会过时的内容（"某年某月前用旧 API"）放进"旧模式"折叠区做历史参考，正文只写当前做法
- **术语全程一致**：选定一套用到底。不要混用 "API endpoint"/"URL"/"API route"/"path"，"字段"/"控件"/"元素"，"提取"/"拉取"/"获取"
- **路径一律正斜杠**（`scripts/helper.py`），包括在 Windows 上——反斜杠在类 Unix 系统会出错。完整规范见 [paths.md](paths.md)
- **给默认方案 + 逃生舱，而非罗列等价选项**："用 pdfplumber 提取文本；扫描件需要 OCR 时改用 pdf2image + pytesseract"，不要罗列五六个库让模型自己挑
- **引用 MCP 工具用完全限定名**（目标工具要求的格式，常见为 `服务器名:工具名`），多服务器场景下不带前缀会找不到工具

## 评测先行

**先建评测，再写大篇幅文档**——确保技能解决的是真实问题，而不是想象的问题：

1. **找差距**：不带技能跑几个代表性任务，记录具体的失败点或缺的上下文
2. **建评测**：针对这些差距建至少 3 个场景
3. **测基线**：量化无技能时的表现
4. **写最小指令**：只写刚好能补上差距、通过评测的内容
5. **迭代**：跑评测、对比基线、打磨

不确定技能该覆盖什么时，起草前先无技能跑 1–2 个任务观察失败点，比凭空设想高效得多。skill-forge 的迭代循环（带技能/基线对比运行 + 人工审阅）就是这个流程的自动化版本。

## 跨模型测试

技能是模型的增量补丁，效果取决于底层模型：

- **较弱模型**：指引够不够细？
- **较强模型**：是否过度解释、反而啰嗦？

对强模型刚好的写法，弱模型可能需要更多细节。计划跨工具、跨模型分发技能时，用不同档位的模型各跑一轮评测，目标是指令在所有档位上都表现良好。

## 发布前检查清单

### 核心质量
- [ ] description 具体、含关键触发词
- [ ] description 同时写了"做什么"和"何时用"
- [ ] description 全程第三人称
- [ ] SKILL.md 正文在 500 行以内
- [ ] 细节已按需拆分到独立文件
- [ ] 无时效性信息（或已收入"旧模式"区）
- [ ] 术语全程一致
- [ ] 示例具体，不抽象
- [ ] 引用一层深（全部从 SKILL.md 直链）
- [ ] 渐进式披露使用得当
- [ ] 工作流步骤清晰
- [ ] 每段内容经得起"精简三问"

### 代码与脚本
- [ ] 脚本自行处理错误，不抛给模型
- [ ] 错误处理明确、报错信息可定位
- [ ] 无 voodoo 常量（取值均有理由）
- [ ] 依赖已声明且验证可用
- [ ] "执行"还是"当参考读"意图明确
- [ ] 路径符合 [paths.md](paths.md)：正斜杠、技能根相对引用、无个人机器绝对路径
- [ ] 项目根按固定优先级解析并校验存在
- [ ] 脚本可从任意 cwd 运行
- [ ] 示例命令单行、跨 shell，输出目录用 `<下载目录>` 占位符
- [ ] 关键操作有验证步骤
- [ ] 质量关键任务有反馈循环

### 测试
- [ ] 至少 3 个评测用例
- [ ] 跨模型档位测试过
- [ ] 用真实使用场景测过
- [ ] 团队反馈已纳入（如适用）
