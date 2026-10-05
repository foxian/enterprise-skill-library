import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createToolLink,
  listToolLinks,
  loadToolLinkManifest,
  reconcileToolLinks,
  removeToolLinks,
  repairRecordedToolLinks,
  resolveToolName,
  TOOL_DISPLAY_NAMES,
  toolDisplayName,
  toolDirectory,
  type ToolName
} from '../src/index.js';

const IDENTITY = '@myorg/reconcile-demo';

function createStoreRoot(): string {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-reconcile-store-'));
  const sourceDir = path.join(storeRoot, 'skills', '@myorg', 'reconcile-demo');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, 'SKILL.md'),
    '---\nname: reconcile-demo\ndescription: Reconcile test skill.\n---\n\n# Reconcile Demo\n'
  );
  return storeRoot;
}

describe('tool display names', () => {
  it('maps every supported tool to its human-readable display name', () => {
    expect(TOOL_DISPLAY_NAMES).toEqual({
      claude: 'Claude Code',
      codex: 'Codex',
      cursor: 'Cursor',
      'trae-intl': 'Trae International',
      'trae-cn': 'Trae CN',
      workbuddy: 'WorkBuddy',
      opencode: 'OpenCode',
      openclaw: 'OpenClaw',
      hermes: 'Hermes'
    });
  });

  it('returns the display name without changing the canonical id', () => {
    expect(toolDisplayName('claude')).toBe('Claude Code');
    expect(toolDisplayName('trae-intl')).toBe('Trae International');
    expect(resolveToolName('claude')).toBe('claude');
    expect(resolveToolName('claude-code')).toBe('claude');
  });
});

describe('reconcileToolLinks', () => {
  let storeRoot: string;
  let projectRoot: string;
  let homeDir: string;

  beforeEach(() => {
    storeRoot = createStoreRoot();
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-reconcile-proj-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-reconcile-home-'));
  });

  afterEach(() => {
    fs.rmSync(storeRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function linkTarget(tool: ToolName): string {
    return path.join(toolDirectory(tool, 'project', { projectRoot, homeDir }), 'myorg_reconcile-demo');
  }

  it('ensures missing links in the expected set and removes ESL-managed links outside it', async () => {
    await createToolLink({ identity: IDENTITY, tool: 'cursor', level: 'project', storeRoot, projectRoot, homeDir });

    const result = await reconcileToolLinks({
      storeRoot,
      identity: IDENTITY,
      level: 'project',
      tools: ['claude', 'codex'],
      projectRoot,
      homeDir
    });

    expect(result.status).toBe('reconciled');
    expect(fs.realpathSync(linkTarget('claude'))).toBe(fs.realpathSync(path.join(storeRoot, 'skills', '@myorg', 'reconcile-demo')));
    expect(fs.realpathSync(linkTarget('codex'))).toBe(fs.realpathSync(path.join(storeRoot, 'skills', '@myorg', 'reconcile-demo')));
    expect(fs.existsSync(linkTarget('cursor'))).toBe(false);

    const manifest = await loadToolLinkManifest(storeRoot);
    const tools = manifest.links
      .filter((record) => record.identity === IDENTITY && record.level === 'project')
      .map((record) => record.tool)
      .sort();
    expect(tools).toEqual(['claude', 'codex']);
  });

  it('supports ensure-only reconciliation (prune: false) keeping out-of-set links', async () => {
    await createToolLink({ identity: IDENTITY, tool: 'cursor', level: 'project', storeRoot, projectRoot, homeDir });
    await createToolLink({ identity: IDENTITY, tool: 'claude', level: 'project', storeRoot, projectRoot, homeDir });

    const result = await reconcileToolLinks({
      storeRoot,
      identity: IDENTITY,
      level: 'project',
      tools: ['claude'],
      projectRoot,
      homeDir,
      prune: false
    });

    expect(result.status).toBe('reconciled');
    expect(result.removed).toEqual([]);
    expect(fs.existsSync(linkTarget('cursor'))).toBe(true);
    const manifest = await loadToolLinkManifest(storeRoot);
    expect(
      manifest.links.filter((record) => record.identity === IDENTITY).map((record) => record.tool).sort()
    ).toEqual(['claude', 'cursor']);
  });

  it('is idempotent when the expected set already matches the manifest', async () => {
    await createToolLink({ identity: IDENTITY, tool: 'claude', level: 'project', storeRoot, projectRoot, homeDir });

    const result = await reconcileToolLinks({
      storeRoot,
      identity: IDENTITY,
      level: 'project',
      tools: ['claude'],
      projectRoot,
      homeDir
    });

    expect(result.status).toBe('reconciled');
    expect(result.ensured.map((entry) => entry.status)).toEqual(['existing']);
    expect(result.removed).toEqual([]);
  });

  it('does not delete unmanaged tool directory content outside the expected set', async () => {
    const foreignDir = linkTarget('cursor');
    fs.mkdirSync(path.dirname(foreignDir), { recursive: true });
    fs.mkdirSync(foreignDir);
    fs.writeFileSync(path.join(foreignDir, 'SKILL.md'), 'hand placed\n');

    await createToolLink({ identity: IDENTITY, tool: 'claude', level: 'project', storeRoot, projectRoot, homeDir });

    const result = await reconcileToolLinks({
      storeRoot,
      identity: IDENTITY,
      level: 'project',
      tools: ['claude'],
      projectRoot,
      homeDir
    });

    expect(result.status).toBe('reconciled');
    expect(fs.existsSync(foreignDir)).toBe(true);
    const entries = await listToolLinks({ storeRoot, level: 'project', projectRoot, homeDir });
    const unmanaged = entries.find(
      (entry) => entry.tool === 'cursor' && entry.identity === 'myorg_reconcile-demo'
    );
    expect(unmanaged?.managed).toBe(false);
  });

  it('keeps existing ESL-managed links and fails when an expected link conflicts', async () => {
    await createToolLink({ identity: IDENTITY, tool: 'claude', level: 'project', storeRoot, projectRoot, homeDir });

    // A foreign directory occupies the codex target; expect both claude and codex.
    const blockedTarget = linkTarget('codex');
    fs.mkdirSync(path.dirname(blockedTarget), { recursive: true });
    fs.mkdirSync(blockedTarget);

    const result = await reconcileToolLinks({
      storeRoot,
      identity: IDENTITY,
      level: 'project',
      tools: ['claude', 'codex'],
      projectRoot,
      homeDir
    });

    expect(result.status).toBe('failed');
    expect(result.failures.map((entry) => entry.tool)).toEqual(['codex']);
    // The old managed link must survive.
    expect(fs.existsSync(linkTarget('claude'))).toBe(true);
    const manifest = await loadToolLinkManifest(storeRoot);
    expect(
      manifest.links.filter((record) => record.identity === IDENTITY).map((record) => record.tool)
    ).toEqual(['claude']);
  });

  it('decrements only the removed Trae reference and keeps the shared physical link', async () => {
    // trae-intl and trae-cn share the same project directory (.trae/skills).
    await createToolLink({ identity: IDENTITY, tool: 'trae-intl', level: 'project', storeRoot, projectRoot, homeDir });
    await createToolLink({ identity: IDENTITY, tool: 'trae-cn', level: 'project', storeRoot, projectRoot, homeDir });
    const sharedPhysical = linkTarget('trae-intl');
    expect(linkTarget('trae-cn')).toBe(sharedPhysical);

    const result = await reconcileToolLinks({
      storeRoot,
      identity: IDENTITY,
      level: 'project',
      tools: ['trae-intl'],
      projectRoot,
      homeDir
    });

    expect(result.status).toBe('reconciled');
    expect(fs.existsSync(sharedPhysical)).toBe(true);
    const manifest = await loadToolLinkManifest(storeRoot);
    expect(
      manifest.links.filter((record) => record.identity === IDENTITY).map((record) => record.tool)
    ).toEqual(['trae-intl']);
  });
});

describe('listToolLinks / removeToolLinks / repairRecordedToolLinks', () => {
  let storeRoot: string;
  let projectRoot: string;
  let homeDir: string;

  beforeEach(() => {
    storeRoot = createStoreRoot();
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-links-proj-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-links-home-'));
  });

  afterEach(() => {
    fs.rmSync(storeRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function linkTarget(tool: ToolName): string {
    return path.join(toolDirectory(tool, 'project', { projectRoot, homeDir }), 'myorg_reconcile-demo');
  }

  it('reports a recorded link whose target is missing as broken', async () => {
    await createToolLink({ identity: IDENTITY, tool: 'claude', level: 'project', storeRoot, projectRoot, homeDir });
    fs.rmSync(linkTarget('claude'), { recursive: true, force: true });

    const entries = await listToolLinks({ storeRoot, level: 'project', projectRoot, homeDir });
    const claude = entries.find((entry) => entry.tool === 'claude' && entry.identity === IDENTITY);

    expect(claude).toMatchObject({ status: 'broken', managed: true, targetDir: linkTarget('claude') });
  });

  it('lists a present but unrecorded target as unmanaged', async () => {
    const foreign = linkTarget('cursor');
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.mkdirSync(foreign);
    fs.writeFileSync(path.join(foreign, 'SKILL.md'), 'hand placed\n');

    const entries = await listToolLinks({ storeRoot, level: 'project', projectRoot, homeDir });
    const unmanaged = entries.find((entry) => entry.tool === 'cursor');

    expect(unmanaged?.managed).toBe(false);
    expect(unmanaged?.status).toBe('unmanaged');
  });

  it('removes only the requested tool links and keeps the shared Trae link', async () => {
    await createToolLink({ identity: IDENTITY, tool: 'trae-intl', level: 'project', storeRoot, projectRoot, homeDir });
    await createToolLink({ identity: IDENTITY, tool: 'trae-cn', level: 'project', storeRoot, projectRoot, homeDir });
    const shared = linkTarget('trae-intl');

    const removed = await removeToolLinks({
      storeRoot,
      identity: IDENTITY,
      tools: ['trae-intl'],
      level: 'project'
    });

    expect(removed.map((entry) => entry.tool)).toEqual(['trae-intl']);
    expect(fs.existsSync(shared)).toBe(true);
    const manifest = await loadToolLinkManifest(storeRoot);
    expect(manifest.links.map((record) => record.tool)).toEqual(['trae-cn']);
  });

  it('repairs missing and stale recorded links without touching unmanaged content', async () => {
    await createToolLink({ identity: IDENTITY, tool: 'claude', level: 'project', storeRoot, projectRoot, homeDir });
    await createToolLink({ identity: IDENTITY, tool: 'codex', level: 'project', storeRoot, projectRoot, homeDir });
    const sourceDir = path.join(storeRoot, 'skills', '@myorg', 'reconcile-demo');

    // claude: link removed entirely; codex: stale symlink pointing elsewhere.
    fs.rmSync(linkTarget('claude'), { recursive: true, force: true });
    const wrong = path.join(projectRoot, 'wrong');
    fs.mkdirSync(wrong);
    fs.rmSync(linkTarget('codex'), { recursive: true, force: true });
    fs.symlinkSync(wrong, linkTarget('codex'), process.platform === 'win32' ? 'junction' : 'dir');

    const results = await repairRecordedToolLinks({ storeRoot, level: 'project', projectRoot, homeDir });

    expect(results.map((entry) => [entry.tool, entry.status])).toEqual([
      ['claude', 'created'],
      ['codex', 'created']
    ]);
    expect(fs.realpathSync(linkTarget('claude'))).toBe(fs.realpathSync(sourceDir));
    expect(fs.realpathSync(linkTarget('codex'))).toBe(fs.realpathSync(sourceDir));
  });

  it('reports a conflict and never overwrites unmanaged content during repair', async () => {
    await createToolLink({ identity: IDENTITY, tool: 'claude', level: 'project', storeRoot, projectRoot, homeDir });
    fs.rmSync(linkTarget('claude'), { recursive: true, force: true });
    fs.mkdirSync(linkTarget('claude'), { recursive: true });
    fs.writeFileSync(path.join(linkTarget('claude'), 'SKILL.md'), '# Manual\n');

    const results = await repairRecordedToolLinks({ storeRoot, level: 'project', projectRoot, homeDir });

    expect(results.map((entry) => entry.status)).toEqual(['conflict']);
    expect(fs.readFileSync(path.join(linkTarget('claude'), 'SKILL.md'), 'utf8')).toBe('# Manual\n');
  });

  it('scopes repair to the given identities', async () => {
    await createToolLink({ identity: IDENTITY, tool: 'claude', level: 'project', storeRoot, projectRoot, homeDir });
    fs.rmSync(linkTarget('claude'), { recursive: true, force: true });

    const untouched = await repairRecordedToolLinks({
      storeRoot,
      level: 'project',
      projectRoot,
      homeDir,
      identities: new Set(['@myorg/other'])
    });
    expect(untouched).toEqual([]);
    expect(fs.existsSync(linkTarget('claude'))).toBe(false);

    const repaired = await repairRecordedToolLinks({
      storeRoot,
      level: 'project',
      projectRoot,
      homeDir,
      identities: new Set([IDENTITY])
    });
    expect(repaired.map((entry) => entry.status)).toEqual(['created']);
  });
});
