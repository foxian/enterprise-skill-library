// @foxian/esl 安装期入口。
//
// 发布包内的 dist/postinstall.js 负责同步全局内置技能（ADR-0008）。但在源码仓库
// 全新克隆时，`npm install` 会先于 `npm run build` 执行，此时 `dist/` 尚不存在。
// 该入口在 dist 缺失时静默跳过，确保 postinstall 不会阻断安装（ADR-0008）。
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(cliDir, 'dist', 'postinstall.js');

if (!existsSync(entry)) {
  // 开发检出场景：dist 尚未构建，跳过同步；后续 CLI 执行会重试（ADR-0008）。
  process.exit(0);
}

try {
  await import(pathToFileURL(entry).href);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`esl: built-in skill global sync deferred: ${message}`);
}
