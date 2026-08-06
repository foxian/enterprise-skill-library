import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ClaudeAdapter,
  CodexAdapter,
  SUPPORTED_TOOLS,
  TraeAdapter,
  getAdapter
} from '../src/adapt/index.js';

describe('ToolAdapter implementations', () => {
  let tmpDir: string;
  let srcDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-adapter-'));
    srcDir = path.join(tmpDir, 'source-skill');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '# Test Skill');
    fs.mkdirSync(path.join(srcDir, 'scripts'));
    fs.writeFileSync(path.join(srcDir, 'scripts', 'run.sh'), '#!/bin/bash');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ClaudeAdapter targets .claude/skills/', () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.name).toBe('claude');
    expect(adapter.projectDir(tmpDir)).toBe(path.join(tmpDir, '.claude', 'skills'));
  });

  it('CodexAdapter targets .agents/skills/', () => {
    const adapter = new CodexAdapter();
    expect(adapter.name).toBe('codex');
    expect(adapter.projectDir(tmpDir)).toBe(path.join(tmpDir, '.agents', 'skills'));
  });

  it('TraeAdapter targets .trae/skills/', () => {
    const adapter = new TraeAdapter();
    expect(adapter.name).toBe('trae');
    expect(adapter.projectDir(tmpDir)).toBe(path.join(tmpDir, '.trae', 'skills'));
  });

  it('adapt copies skill to target directory', async () => {
    const adapter = new ClaudeAdapter();
    const targetBase = path.join(tmpDir, '.claude', 'skills');

    await adapter.adapt(srcDir, 'my-skill', targetBase);

    expect(fs.readFileSync(path.join(targetBase, 'my-skill', 'SKILL.md'), 'utf8')).toBe(
      '# Test Skill'
    );
    expect(fs.readFileSync(path.join(targetBase, 'my-skill', 'scripts', 'run.sh'), 'utf8')).toBe(
      '#!/bin/bash'
    );
  });

  it('clean removes all contents from target base directory', async () => {
    const adapter = new ClaudeAdapter();
    const targetBase = path.join(tmpDir, '.claude', 'skills');
    await adapter.adapt(srcDir, 'my-skill', targetBase);

    await adapter.clean(targetBase);

    expect(fs.existsSync(targetBase)).toBe(false);
  });

  it('getAdapter returns correct adapter by name', () => {
    expect(getAdapter('claude')).toBeInstanceOf(ClaudeAdapter);
    expect(getAdapter('codex')).toBeInstanceOf(CodexAdapter);
    expect(getAdapter('trae')).toBeInstanceOf(TraeAdapter);
  });

  it('getAdapter throws for unknown tool', () => {
    expect(() => getAdapter('unknown')).toThrow('Unknown tool: unknown');
  });

  it('exports SUPPORTED_TOOLS', () => {
    expect(SUPPORTED_TOOLS).toEqual(['claude', 'codex', 'trae']);
  });
});
