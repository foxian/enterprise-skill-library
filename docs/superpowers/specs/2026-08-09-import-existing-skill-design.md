# 导入已有本地技能设计

> 日期：2026-08-09
> 状态：待用户审阅

## 1. 背景

已有 Agent 技能目录通常只有 `SKILL.md`。当前 ESL 的 `install` 要求输入目录已经是合法 skill package，因此至少需要 `skill.json` 和 `SKILL.md`。这让用户把已有本地技能安装到当前项目时，需要手动创建 `skill.json`，体验不直接。

同时，`init` 现在会创建 `scripts/`、`references/`、`assets/` 空目录，但这些目录不是 ESL 合法包的必需条件。默认创建空目录会让最小包结构显得比实际更复杂。

## 2. 设计目标

- 让已有本地技能可以通过一条命令导入并安装到当前项目。
- 保持 `validate` 只检查不写文件。
- 保持 `init` 只负责创建新技能，不承担导入已有目录的语义。
- 使用最小 skill package：只要求 `SKILL.md` 和 `skill.json`。
- 避免 `import` 暗中重命名技能短名。
- 复用现有 `install` 和 `adapt` 行为，减少重复实现。

## 3. 命令设计

新增命令：

```powershell
npm exec -- esl import <path>
```

默认 namespace 为 `local`。如果 `SKILL.md` frontmatter 中的 `name` 是 `brainstorming`，则导入身份为：

```text
@local/brainstorming
```

用户可以显式指定 namespace：

```powershell
npm exec -- esl import <path> --namespace cnfox
```

此时导入身份为：

```text
@cnfox/brainstorming
```

不提供 `--name` 参数。`import` 从 `SKILL.md.name` 决定 skill-name，只允许用户通过 `--namespace` 选择命名空间。这样可以避免用户误以为 import 可以把 `brainstorming` 改名为 `idea-design`。

`import` 支持沿用 install 的适配控制：

```powershell
npm exec -- esl import <path> --no-adapt
```

## 4. 导入行为

`esl import <path>` 执行以下步骤：

1. 解析 `<path>` 为本地目录。
2. 要求目录中存在 `SKILL.md`。
3. 读取并校验 `SKILL.md` frontmatter。
4. 根据 `SKILL.md.name` 和 `--namespace` 生成完整 skill name。
5. 如果目录中没有 `skill.json`，生成最小 `skill.json`。
6. 如果目录中已有 `skill.json`，不覆盖。
7. 跑现有 `validateSkillDirectory`。
8. 调用现有本地路径 `install` 逻辑，把技能安装到当前项目的 `.skills`。
9. 默认执行现有 project adapt；传入 `--no-adapt` 时跳过。

成功后，当前项目至少会有：

```text
.skills/@local/brainstorming/
  SKILL.md
  skill.json
skills.json
```

如果未传 `--no-adapt`，现有适配器还会把 `.skills` 中的技能同步到支持的 Agent 目录。

## 5. 最小 skill.json

当已有目录缺少 `skill.json` 时，`import` 生成：

```json
{
  "name": "@local/brainstorming",
  "version": "0.1.0",
  "description": "Description from SKILL.md frontmatter.",
  "author": "cnfox",
  "keywords": []
}
```

字段来源：

- `name`：`@${namespace}/${skillMd.name}`，默认 namespace 为 `local`。
- `version`：固定初始值 `0.1.0`。
- `description`：来自 `SKILL.md` frontmatter。
- `author`：沿用 `init` 当前逻辑，从 `USER`、`USERNAME` 推断，无法推断时使用 `anonymous`。
- `keywords`：空数组。

## 6. 错误处理

以下情况应报错并停止，不写入当前项目的 `.skills`：

- `<path>` 不存在或不是目录。
- `SKILL.md` 不存在。
- `SKILL.md` 缺少合法 frontmatter。
- `SKILL.md.name` 不符合短名规则。
- `--namespace` 不符合 namespace 规则。
- 已有 `skill.json.name` 的 namespace 或 skill-name 与导入身份不一致。
- 目录名与 `SKILL.md.name` 不一致，导致现有 validate 失败。

`import` 不自动修改 `SKILL.md`，不自动改目录名，也不覆盖已有 `skill.json`。如果需要重命名技能，应以后设计明确的 rename 命令。

## 7. init 行为调整

`esl init @namespace/foo` 改为只创建最小包结构：

```text
foo/
  skill.json
  SKILL.md
```

不再默认创建：

```text
scripts/
references/
assets/
```

这些目录仍然是允许的可选组织结构，但不由 `init` 默认创建，也不作为 package 校验的必需条件。

## 8. 模块边界

可复用逻辑放在 `packages/core`：

- 读取并校验 `SKILL.md` frontmatter。
- 根据 namespace 和 `SKILL.md` 生成最小 `skill.json` 数据。
- 在缺少 `skill.json` 时写入最小文件。

CLI 行为放在 `packages/cli`：

- 解析 `esl import` 参数。
- 处理 `--namespace` 和 `--no-adapt`。
- 调用 core 导入准备逻辑。
- 调用现有 `executeInstall` 完成当前项目安装。
- 输出成功或错误信息。

`packages/cli` 不重复实现复制、依赖登记或 adapter 行为，继续复用现有 install 流程。

## 9. 测试

核心测试：

- 缺少 `skill.json` 的目录可以生成最小 `skill.json`。
- 默认 namespace 为 `local`。
- `--namespace cnfox` 生成 `@cnfox/<skill-name>`。
- 已有不匹配 `skill.json.name` 时失败且不覆盖。
- 无效 `SKILL.md` 时失败。

CLI 测试：

- `esl import <path>` 会导入缺少 `skill.json` 的已有技能并安装到 `.skills/@local/<name>`。
- `esl import <path> --namespace cnfox` 会安装到 `.skills/@cnfox/<name>`。
- `--no-adapt` 会传递给现有 install 行为并跳过 adapter 输出。
- `init` 只创建 `skill.json` 和 `SKILL.md`，不再创建三个空目录。

验证命令：

```powershell
npm test
npm run build
```
