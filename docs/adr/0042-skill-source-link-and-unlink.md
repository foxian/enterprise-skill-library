# Skill Source Link：本地源码目录的符号链接安装

Status: accepted

开发者在本地持续修改技能源码时，`esl install ./path` 的复制副本每次改动都需要重装；
`esl link` 参照 npm link 提供符号链接安装：本地技能源码目录以 symlink 形式进入
Skill Store（Windows 用 junction，类 Unix 用 symlink），与既有 Tool Link 组成两层链路
（工具目录 → store 位置 → 源码目录），源码改动对所有工具即时生效。link 创建时解析
`release.json` 的 `name` 作为安装身份：完整 `@scope/name` 直接使用；裸短名默认落保留
Scope `@local`（ADR-0032 禁止 CLI 依赖登录态展开个人命名空间），`--identity` 允许
显式补全 scope（短名必须与源码一致，只能补全不能改名）。link 不读取、不写入、不生成
`skill.json`——它是安装副本与 Published Skill Package 的生成物（ADR-0007），写入会
穿透 symlink 污染源码目录；安装身份、版本与来源改记入 Install Manifest，`list` 与
工具链路照常工作。

当同一身份在 store 中已有普通安装副本时，`esl link` 默认报错，`--force` 将该副本
**移入** store 内暂存区 `.eslib/link-staging/`（不删除），store 位置改为指向源码的
symlink；Tool Link 指向的 store 位置不变，无需重建。`esl uninstall` 对 link 安装只移除
symlink、Install Manifest 记录、Tool Link 与暂存副本，绝不递归源码目录，并在输出中
声明源码未删除。`esl unlink` 是带恢复语义的解除命令：存在暂存副本时按暂存的
resolved 与 integrity **纯本地**移回原位并恢复 Install Manifest 为 registry 状态，不
重新访问网络；无暂存（link 的是新身份）时退化为删除链接与记录；暂存区被破坏时
报错并保留 link 状态。`esl update` 跳过 link 安装的技能并注明，因为 link 的内容
始终是源码实时状态，静默替换成 registry 副本等于悄悄撤销开发模式。

拒绝的备选方案：Tool Link 直接指向源码目录（破坏 ADR-0041 的 store 单一真相契约，
且 `use` 等读 store 的命令会读到旧副本）；link 时在源码目录生成 `skill.json`（污染
源码，违背 Skill Manifest 只存在于生成物的边界）；`--force` 删除原副本、unlink 时重新
下载（恢复依赖网络，resolved URL 失效即无法恢复）。
