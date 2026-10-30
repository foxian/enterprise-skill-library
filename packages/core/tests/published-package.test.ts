import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preparePublishedSkillPackage } from '../src/skill/published-package.js';
import { createPublishedSkillPackage, parsePublishedSkillPackage, sha256Integrity } from '../src/skill/published-package-archive.js';

describe('Published Skill Package', () => {
  let root: string;
  let source: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-package-'));
    source = path.join(root, 'reviewer');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'skill.json'), JSON.stringify({
      name: '@platform-ai/reviewer',
      version: '1.0.0',
      description: 'Reviewer',
      author: 'alice'
    }));
    fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: reviewer\ndescription: Reviewer\n---\n');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('rewrites the package display name while leaving source short-name validation intact', async () => {
    await preparePublishedSkillPackage(source, '@platform-ai/reviewer');

    expect(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8')).toContain('name: platform-ai:reviewer');
    expect(JSON.parse(fs.readFileSync(path.join(source, 'skill.json'), 'utf8')).name)
      .toBe('@platform-ai/reviewer');
  });
  it('round-trips binary files and UTF-8 text through the ZIP package', async () => {
    const binary = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x42]);
    const packageBytes = await createPublishedSkillPackage({
      name: '@platform-ai/reviewer',
      skillId: 'skill-1',
      version: '1.0.0',
      sourceCommit: 'abc123',
      releaseManifest: { name: '@platform-ai/reviewer', version: '1.0.0' }
    }, {
      'SKILL.md': Buffer.from('你好，世界\n', 'utf8'),
      'assets/example.docx': binary
    });

    const parsed = await parsePublishedSkillPackage(packageBytes);
    expect(parsed.files['SKILL.md'].toString('utf8')).toBe('你好，世界\n');
    expect(parsed.files['assets/example.docx'].equals(binary)).toBe(true);
    expect(sha256Integrity(packageBytes)).toMatch(/^sha256-[0-9a-f]{64}$/);
  });

  it('keeps compatibility with legacy JSON packages', async () => {
    const legacy = Buffer.from(JSON.stringify({
      name: '@platform-ai/reviewer',
      skillId: 'skill-1',
      version: '1.0.0',
      sourceCommit: 'abc123',
      releaseManifest: { name: '@platform-ai/reviewer', version: '1.0.0' },
      files: { 'SKILL.md': '---\nname: reviewer\n---\n' }
    }), 'utf8');
    const parsed = await parsePublishedSkillPackage(legacy);
    expect(parsed.files['SKILL.md'].toString('utf8')).toContain('name: reviewer');
  });

  it('rejects unsafe package paths', async () => {
    await expect(createPublishedSkillPackage({
      name: '@platform-ai/reviewer', skillId: 'skill-1', version: '1.0.0', sourceCommit: 'abc123', releaseManifest: {}
    }, { '../escape.docx': Buffer.from('bad') })).rejects.toThrow(/unsafe path/i);
  });
  it('固定输入按文件排序生成相同 ZIP', async () => {
    const metadata = { name: '@alice/reviewer', skillId: 'sk_1', version: '1.0.0', sourceCommit: 'abc123', releaseManifest: {} };
    const a = Buffer.from('a');
    const b = Buffer.from([0xff, 0x00]);
    expect(await createPublishedSkillPackage(metadata, { b, a })).toEqual(await createPublishedSkillPackage(metadata, { a, b }));
  });

  it.each(['C:escape', 'file:stream', 'CON.txt', 'trailing.', 'a/../escape'])('拒绝不安全路径 %s', async (filePath) => {
    await expect(createPublishedSkillPackage({ name: '@alice/reviewer', skillId: 'sk_1', version: '1.0.0', sourceCommit: 'abc123', releaseManifest: {} }, { [filePath]: Buffer.from('bad') })).rejects.toThrow(/path/i);
  });

  it.each([['A.txt', 'a.txt'], ['a', 'a/b'], ['a/b', 'a']])('拒绝冲突路径 %s 和 %s', async (a, b) => {
    await expect(createPublishedSkillPackage({ name: '@alice/reviewer', skillId: 'sk_1', version: '1.0.0', sourceCommit: 'abc123', releaseManifest: {} }, { [a]: Buffer.from('a'), [b]: Buffer.from('b') })).rejects.toThrow(/conflicting paths/i);
  });

  it('解包时拒绝被 ZIP 库清洗的穿越路径', async () => {
    const zip = new JSZip();
    zip.file('esl-package.json', '{}');
    zip.file('files/../escape', 'bad');
    await expect(parsePublishedSkillPackage(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(/unsafe path/i);
  });

});


describe('特殊文件名原字节保留', () => {
  it('ZIP 与旧 JSON 均保留 __proto__ 文件', async () => {
    const legacy = Buffer.from('{"files":{"__proto__":"text"}}');
    expect((await parsePublishedSkillPackage(legacy)).files['__proto__']).toEqual(Buffer.from('text'));
    const bytes = await createPublishedSkillPackage({
      name: '@alice/demo', skillId: 'sk_demo', version: '1.0.0', sourceCommit: 'abc', releaseManifest: {}
    }, Object.fromEntries([['__proto__', Buffer.from('text')]]));
    expect((await parsePublishedSkillPackage(bytes)).files['__proto__']).toEqual(Buffer.from('text'));
  });
});
