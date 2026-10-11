import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureGitAvailable } from '../git.js';
import { fileExists } from '../store/file-copy.js';
import { parseSkillIdentity } from '../schema/release-manifest.js';

const defaultExecFileAsync = promisify(execFile);

export interface ExportSourceOptions {
  directory?: string;
  output?: string;
  execFileAsync?: typeof defaultExecFileAsync;
}

export interface ExportSourceResult {
  directory: string;
  output: string;
  skillName: string;
  files: number;
}

/**
 * 导出一个不带 Git 托管身份的技能播种副本。语义类似 git archive：只导出
 * HEAD 中已提交的文件，不读取或修改源目录的工作树内容。
 */
export async function executeExportSource(options: ExportSourceOptions = {}): Promise<ExportSourceResult> {
  const directory = path.resolve(options.directory ?? process.cwd());
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  await ensureGitAvailable();

  const root = (await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: directory })).stdout.trim();
  if (path.resolve(root) !== directory) {
    throw new Error('Export requires the skill directory to be the Git repository root');
  }
  const status = await execFileAsync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: directory });
  if (status.stdout.trim()) {
    throw new Error(`Skill source at ${directory} has uncommitted changes; commit or stash them before exporting`);
  }

  const manifestPath = path.join(directory, 'release.json');
  if (!(await fileExists(manifestPath))) {
    throw new Error(`Skill source at ${directory} has no release.json`);
  }
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { name?: unknown };
  if (typeof manifest.name !== 'string') {
    throw new Error(`release.json at ${manifestPath} must contain a skill name`);
  }
  const identity = parseSkillIdentity(manifest.name);
  if (!identity) throw new Error(`release.json at ${manifestPath} contains an invalid skill name`);

  const output = path.resolve(options.output ?? path.join(path.dirname(directory), `${identity.shortName}-export`));
  if (output === directory || output.startsWith(`${directory}${path.sep}`)) {
    throw new Error(`Export output must not be inside the source directory: ${output}`);
  }
  if (await fileExists(output)) throw new Error(`Export output already exists: ${output}`);

  const listed = await execFileAsync('git', ['ls-tree', '-rz', '--name-only', 'HEAD'], { cwd: directory });
  const files = listed.stdout.split('\0').filter(Boolean);
  if (!files.includes('release.json')) throw new Error('release.json must be committed before exporting');

  await fs.mkdir(output, { recursive: true });
  for (const relative of files) {
    const source = path.join(directory, relative);
    const target = path.join(output, relative);
    const stat = await fs.lstat(source);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (stat.isSymbolicLink()) await fs.symlink(await fs.readlink(source), target);
    else await fs.copyFile(source, target);
  }

  const exportedManifestPath = path.join(output, 'release.json');
  const exportedManifest = { ...manifest, name: identity.shortName };
  await fs.writeFile(exportedManifestPath, `${JSON.stringify(exportedManifest, null, 2)}\n`, 'utf8');

  return { directory, output, skillName: identity.shortName, files: files.length };
}

