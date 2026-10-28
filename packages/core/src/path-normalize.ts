import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 归一化路径以便比较：存在的路径取 realpath；不存在的路径对最近的已存在父目录
 * 取 realpath 后再拼回缺失的尾段。
 *
 * macOS 的 /var/... 会被 realpath 成 /private/var/...，Windows 的临时目录也可能
 * 出现 8.3 短名或 \\?\ 长路径形式。调用方若只对一侧取 realpath，两侧比较就会
 * 误判为不同路径。
 */
export async function normalizePathForComparison(input: string): Promise<string> {
  const absolute = path.resolve(input);
  const missing: string[] = [];
  let current = absolute;

  while (true) {
    try {
      const real = await fs.realpath(current);
      return missing.length > 0 ? path.join(real, ...missing.reverse()) : real;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        return absolute;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return absolute;
      }
      missing.push(path.basename(current));
      current = parent;
    }
  }
}
