import crypto from 'node:crypto';
import JSZip from 'jszip';

export type ByteFileMap = Record<string, Buffer>;

export interface PublishedPackageMetadata {
  name: string;
  skillId: string;
  version: string;
  sourceCommit: string;
  releaseManifest: {
    compatibility?: Record<string, unknown>;
    dependencies?: Record<string, string>;
    [key: string]: unknown;
  };
  dependencyLock?: Record<string, unknown>;
}

export interface ParsedBytePublishedPackage extends PublishedPackageMetadata {
  files: ByteFileMap;
}

const PACKAGE_MANIFEST = 'esl-package.json';
const FILE_PREFIX = 'files/';

export function sha256Integrity(bytes: Uint8Array): string {
  return `sha256-${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function assertSafeRelativePath(relativePath: string): void {
  if (!relativePath || relativePath.includes('\\') || relativePath.startsWith('/') || relativePath.includes(':') || /^[A-Za-z]:[\\/]/.test(relativePath)) {
    throw new Error(`Published Skill Package contains an invalid path: ${relativePath}`);
  }
  const normalized = relativePath.split('/');
  if (normalized.some((part) => !part || part === '..' || part === '.' || /[. ]$/.test(part) || /[<>"|?*\x00-\x1f]/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`Published Skill Package contains an unsafe path: ${relativePath}`);
  }
}

export function assertSafePublishedPath(relativePath: string): void {
  assertSafeRelativePath(relativePath);
}

function assertDistinctPaths(paths: string[]): void {
  const seen = new Set<string>();
  const directories = new Set<string>();
  for (const filePath of paths) {
    assertSafeRelativePath(filePath);
    const key = filePath.toLowerCase();
    if (seen.has(key) || directories.has(key)) throw new Error(`Published Skill Package contains conflicting paths: ${filePath}`);
    const parts = key.split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/');
      if (seen.has(parent)) throw new Error(`Published Skill Package contains conflicting paths: ${filePath}`);
      directories.add(parent);
    }
    seen.add(key);
  }
}

export async function createPublishedSkillPackage(
  metadata: PublishedPackageMetadata,
  files: ByteFileMap
): Promise<Buffer> {
  assertDistinctPaths(Object.keys(files));
  const zip = new JSZip();
  const date = new Date('1980-01-01T00:00:00Z');
  zip.file(PACKAGE_MANIFEST, `${JSON.stringify(metadata, null, 2)}\n`, { date });
  for (const [relativePath, bytes] of Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    assertSafeRelativePath(relativePath);
    if (relativePath === PACKAGE_MANIFEST || relativePath.startsWith(`${PACKAGE_MANIFEST}/`)) {
      throw new Error(`Published Skill Package reserves the path: ${relativePath}`);
    }
    zip.file(`${FILE_PREFIX}${relativePath}`, bytes, { date, createFolders: false });
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

function parseLegacyJsonPackage(bytes: Uint8Array): ParsedBytePublishedPackage {
  const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as PublishedPackageMetadata & { files?: Record<string, string> };
  if (!parsed || typeof parsed !== 'object' || !parsed.files || typeof parsed.files !== 'object') {
    throw new Error('Published Skill Package is missing files');
  }
  const files: ByteFileMap = Object.create(null);
  for (const [relativePath, content] of Object.entries(parsed.files)) {
    assertSafeRelativePath(relativePath);
    if (typeof content !== 'string') throw new Error(`Legacy Published Skill Package file is not text: ${relativePath}`);
    files[relativePath] = Buffer.from(content, 'utf8');
  }
  assertDistinctPaths(Object.keys(files));
  return { ...parsed, files };
}

export async function parsePublishedSkillPackage(bytes: Uint8Array): Promise<ParsedBytePublishedPackage> {
  const buffer = Buffer.from(bytes);
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return parseLegacyJsonPackage(buffer);
  }
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const manifestEntry = zip.file(PACKAGE_MANIFEST);
  if (!manifestEntry) throw new Error('Published Skill Package is missing esl-package.json');
  const metadata = JSON.parse(await manifestEntry.async('string')) as PublishedPackageMetadata;
  const files: ByteFileMap = Object.create(null);
  for (const entry of Object.values(zip.files)) {
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) throw new Error('Published Skill Package contains an unsafe path');
    if (entry.dir || entry.name === PACKAGE_MANIFEST) continue;
    if (!entry.name.startsWith(FILE_PREFIX)) throw new Error(`Published Skill Package contains an unexpected entry: ${entry.name}`);
    const relativePath = entry.name.slice(FILE_PREFIX.length);
    assertSafeRelativePath(relativePath);
    files[relativePath] = await entry.async('nodebuffer');
  }
  assertDistinctPaths(Object.keys(files));
  return { ...metadata, files };
}
