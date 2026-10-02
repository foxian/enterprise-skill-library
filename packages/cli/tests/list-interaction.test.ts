import { describe, expect, it, vi } from 'vitest';
import { runListSession } from '../src/commands/list-interaction.js';
import type { InstallManifest, SkillListEntry } from '@esl/core';

const REGISTRY_SKILL: SkillListEntry = {
  name: '@alice/code-review',
  version: '1.0.0',
  source: 'registry',
  displayName: 'Code Review',
  tools: [{ tool: 'claude', status: 'linked', managed: true }]
};

const LINK_SKILL: SkillListEntry = {
  name: '@local/my-helper',
  version: '0.1.0',
  source: 'link',
  linkSourcePath: '/tmp/my-helper',
  tools: []
};

function selectCalls(mock: ReturnType<typeof vi.fn>): Array<{ message: string; choices: Array<{ name: string; value: string; description?: string }> }> {
  return mock.mock.calls.map((call) => call[0]);
}

interface Harness {
  select: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
  checkbox: ReturnType<typeof vi.fn>;
  uninstall: ReturnType<typeof vi.fn>;
  unlink: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  reconcile: ReturnType<typeof vi.fn>;
  logs: string[];
  entries: SkillListEntry[];
  manifest: InstallManifest;
}

function makeHarness(options: { entries?: SkillListEntry[] } = {}): Harness {
  const harness: Harness = {
    select: vi.fn(),
    confirm: vi.fn(),
    checkbox: vi.fn(),
    uninstall: vi.fn().mockResolvedValue({ removedLinks: [], sourceRemoved: true }),
    unlink: vi.fn().mockResolvedValue({ identity: '@local/my-helper', targetDir: '/store/@local/my-helper', sourceDir: '/tmp/my-helper', restored: false }),
    update: vi.fn().mockResolvedValue([{ name: '@alice/code-review', from: '1.0.0', to: '1.1.0' }]),
    reconcile: vi.fn().mockResolvedValue({
      status: 'reconciled',
      ensured: [{ identity: '@alice/code-review', tool: 'codex', targetDir: '/tmp/.codex/skills/@alice_code-review', status: 'created' }],
      removed: [],
      failures: []
    }),
    logs: [],
    entries: options.entries ?? [REGISTRY_SKILL, LINK_SKILL],
    manifest: {
      version: 1,
      skills: {
        '@alice/code-review': {
          identity: '@alice/code-review',
          version: '1.0.0',
          source: 'registry',
          specifier: '^1.0.0',
          sourceDir: 'skills/@alice/code-review',
          installedAt: '2026-01-01T00:00:00.000Z'
        },
        '@local/my-helper': {
          identity: '@local/my-helper',
          version: '0.1.0',
          source: 'link',
          specifier: 'link:../my-helper',
          resolved: '/tmp/my-helper',
          sourceDir: 'skills/@local/my-helper',
          installedAt: '2026-01-01T00:00:00.000Z'
        }
      }
    }
  };
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    harness.logs.push(args.join(' '));
  });
  return harness;
}

function deps(harness: Harness, selectReturnQueue: string[]) {
  let step = 0;
  harness.select.mockImplementation(() => {
    const value = selectReturnQueue[step];
    step += 1;
    return Promise.resolve(value ?? '__exit__');
  });
  return {
    select: harness.select as never,
    confirm: harness.confirm as never,
    checkbox: harness.checkbox as never,
    list: async ({ global }: { global?: boolean }) => {
      expect(global).toBeFalsy();
      return harness.entries;
    },
    loadManifest: async () => harness.manifest,
    uninstall: harness.uninstall as never,
    unlink: harness.unlink as never,
    update: harness.update as never,
    reconcile: harness.reconcile as never
  };
}

describe('esl list interactive session (read-only browsing)', () => {
  it('shows level-1 choices with display name, identity, version and source but no tool names', async () => {
    const harness = makeHarness();

    await runListSession({}, deps(harness, ['@alice/code-review', '__exit__']));

    const [level1] = selectCalls(harness.select);
    expect(level1.message).toBe('Select a skill to manage');
    const labels = level1.choices.map((choice) => choice.name).join('\n');
    expect(labels).toContain('@alice/code-review');
    expect(labels).toContain('Code Review');
    expect(labels).toContain('v1.0.0');
    expect(labels).toContain('(registry)');
    expect(labels).not.toContain('Claude Code');
    expect(level1.choices.at(-1)?.value).toBe('__exit__');
  });

  it('falls back to a recognizable short name when no display name exists', async () => {
    const harness = makeHarness({ entries: [{ name: '@acme/pdf-export', version: '2.0.0', source: 'registry' }] });

    await runListSession({}, deps(harness, ['@acme/pdf-export', '__exit__']));

    const [level1] = selectCalls(harness.select);
    expect(level1.choices[0].name).toContain('@acme/pdf-export');
    expect(level1.choices[0].name).toContain('pdf-export');
  });

  it('prints local-only detail fields and per-tool link status, without server URL or package URL', async () => {
    const harness = makeHarness();

    await runListSession({}, deps(harness, ['@alice/code-review', 'back', '__exit__']));

    const detail = harness.logs.join('\n');
    expect(detail).toContain('Identity: @alice/code-review');
    expect(detail).toContain('Version: 1.0.0');
    expect(detail).toContain('Source: registry');
    expect(detail).toContain('Installed at: 2026-01-01T00:00:00.000Z');
    expect(detail).toContain('Store path: skills/@alice/code-review');
    expect(detail).toContain('Claude Code (claude): linked (managed)');
    expect(detail).not.toMatch(/[Ss]erver/);
    expect(detail).not.toContain('package URL');
    expect(detail).not.toContain('http');
  });

  it('always shows the link source path for source=link skills', async () => {
    const harness = makeHarness();

    await runListSession({}, deps(harness, ['@local/my-helper', 'back', '__exit__']));

    const detail = harness.logs.join('\n');
    expect(detail).toContain('Link source: /tmp/my-helper');
  });

  it('returns from detail to level 1, then exits without changes', async () => {
    const harness = makeHarness();

    await runListSession({}, deps(harness, ['@alice/code-review', 'back', '__exit__']));

    const calls = selectCalls(harness.select);
    expect(calls).toHaveLength(3);
    expect(calls[1].message).toContain('@alice/code-review');
    expect(calls[2].message).toBe('Select a skill to manage');
  });

  it('exits directly from level 1 without showing any detail', async () => {
    const harness = makeHarness();

    await runListSession({}, deps(harness, ['__exit__']));

    expect(harness.logs.join('\n')).not.toContain('Identity:');
  });

  it('prints a scoped message and skips prompts for an empty store', async () => {
    const harness = makeHarness({ entries: [] });

    await runListSession({}, deps(harness, []));

    expect(harness.logs.join('\n')).toContain('No skills installed in this project.');
    expect(harness.select).not.toHaveBeenCalled();
  });

  it('uses the global scope message with --global', async () => {
    const harness = makeHarness({ entries: [] });
    let observedGlobal: boolean | undefined;
    const sessionDeps = deps(harness, []);
    sessionDeps.list = async ({ global }: { global?: boolean }) => {
      observedGlobal = global;
      return [];
    };

    await runListSession({ global: true }, sessionDeps);

    expect(observedGlobal).toBe(true);
    expect(harness.logs.join('\n')).toContain('No global skills installed.');
  });
});

describe('esl list detail: uninstall / unlink actions', () => {
  it('offers uninstall but never unlink for a non-link install', async () => {
    const harness = makeHarness();

    await runListSession({}, deps(harness, ['@alice/code-review', 'back', '__exit__']));

    const [level1, detail] = selectCalls(harness.select);
    void level1;
    const values = detail.choices.map((choice) => choice.value);
    expect(values).toContain('uninstall');
    expect(values).not.toContain('unlink');
  });

  it('offers unlink first with staging semantics for a Skill Source Link install', async () => {
    const harness = makeHarness();

    await runListSession({}, deps(harness, ['@local/my-helper', 'back', '__exit__']));

    const detail = selectCalls(harness.select)[1];
    const values = detail.choices.map((choice) => choice.value);
    expect(values.indexOf('unlink')).toBeLessThan(values.indexOf('uninstall'));
    const unlinkChoice = detail.choices.find((choice) => choice.value === 'unlink');
    expect(unlinkChoice?.description).toContain('Link Staging');
    const uninstallChoice = detail.choices.find((choice) => choice.value === 'uninstall');
    expect(uninstallChoice?.name).toContain('keeps the source directory');
  });

  it('runs the existing unlink path after confirmation and returns to level 1', async () => {
    const harness = makeHarness();
    harness.confirm.mockResolvedValue(true);

    await runListSession({}, deps(harness, ['@local/my-helper', 'unlink', '__exit__']));

    expect(harness.unlink).toHaveBeenCalledWith('@local/my-helper', expect.objectContaining({ global: undefined }));
    expect(harness.uninstall).not.toHaveBeenCalled();
    const calls = selectCalls(harness.select);
    expect(calls.at(-1)?.message).toBe('Select a skill to manage');
  });

  it('makes no change when the unlink confirmation is rejected', async () => {
    const harness = makeHarness();
    harness.confirm.mockResolvedValue(false);

    await runListSession({}, deps(harness, ['@local/my-helper', 'unlink', 'back', '__exit__']));

    expect(harness.unlink).not.toHaveBeenCalled();
    expect(harness.logs.join('\n')).toContain('Unlink cancelled');
    expect(selectCalls(harness.select)[2].message).toContain('@local/my-helper');
  });

  it('uninstalls a link install after confirmation, stating the source directory is kept', async () => {
    const harness = makeHarness();
    harness.confirm.mockResolvedValue(true);
    harness.uninstall.mockResolvedValue({ removedLinks: [], sourceRemoved: false, sourcePath: '/tmp/my-helper' });

    await runListSession({}, deps(harness, ['@local/my-helper', 'uninstall', '__exit__']));

    expect(harness.uninstall).toHaveBeenCalledWith('@local/my-helper', expect.objectContaining({ global: undefined }));
    const confirmMessage = harness.confirm.mock.calls[0][0] as { message: string };
    expect(confirmMessage.message).toContain('NOT deleted');
    expect(harness.logs.join('\n')).toContain('linked source was preserved at /tmp/my-helper');
    expect(selectCalls(harness.select).at(-1)?.message).toBe('Select a skill to manage');
  });

  it('uninstalls a registry install after confirmation', async () => {
    const harness = makeHarness();
    harness.confirm.mockResolvedValue(true);

    await runListSession({}, deps(harness, ['@alice/code-review', 'uninstall', '__exit__']));

    expect(harness.uninstall).toHaveBeenCalledWith('@alice/code-review', expect.objectContaining({ global: undefined }));
    expect(harness.unlink).not.toHaveBeenCalled();
    expect(harness.logs.join('\n')).toContain('Skill @alice/code-review uninstalled');
  });
});

describe('esl list detail: single-skill update', () => {
  it('confirms, runs the same update path as `esl update <identity>`, and stays in the detail', async () => {
    const harness = makeHarness();
    harness.confirm.mockResolvedValue(true);

    await runListSession({}, deps(harness, ['@alice/code-review', 'update', 'back', '__exit__']));

    expect(harness.update).toHaveBeenCalledWith({ skillName: '@alice/code-review', global: undefined });
    expect(harness.logs.join('\n')).toContain('@alice/code-review: 1.0.0 -> 1.1.0');
    const calls = selectCalls(harness.select);
    expect(calls[2].message).toContain('@alice/code-review');
  });

  it('makes no change when the update confirmation is rejected', async () => {
    const harness = makeHarness();
    harness.confirm.mockResolvedValue(false);

    await runListSession({}, deps(harness, ['@alice/code-review', 'update', 'back', '__exit__']));

    expect(harness.update).not.toHaveBeenCalled();
    expect(harness.logs.join('\n')).toContain('Update cancelled');
  });

  it('reports a skipped Skill Source Link update without changing it', async () => {
    const harness = makeHarness();
    harness.confirm.mockResolvedValue(true);
    harness.update.mockResolvedValue([{ name: '@local/my-helper', from: 'link', to: 'linked (skipped)', skipped: 'link' }]);

    await runListSession({}, deps(harness, ['@local/my-helper', 'update', 'back', '__exit__']));

    expect(harness.update).toHaveBeenCalledWith({ skillName: '@local/my-helper', global: undefined });
    expect(harness.logs.join('\n')).toContain('@local/my-helper: linked (skipped)');
  });
});

describe('esl list detail: expected tool link set adjustment', () => {
  it('preselects the existing managed links and reconciles toward the submitted set', async () => {
    const harness = makeHarness();
    harness.confirm.mockResolvedValue(true);
    harness.checkbox.mockResolvedValue(['claude', 'codex']);

    await runListSession({}, deps(harness, ['@alice/code-review', 'tools', 'back', '__exit__']));

    const checkboxCall = harness.checkbox.mock.calls[0][0] as {
      message: string;
      choices: Array<{ value: string; checked: boolean }>;
    };
    expect(checkboxCall.message).toContain('expected tool link set');
    expect(checkboxCall.choices.find((choice) => choice.value === 'claude')?.checked).toBe(true);
    expect(checkboxCall.choices.find((choice) => choice.value === 'codex')?.checked).toBe(false);
    expect(harness.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ identity: '@alice/code-review', level: 'project', tools: ['claude', 'codex'] })
    );
    expect(harness.logs.join('\n')).toContain('Will add: Codex');
    expect(harness.logs.join('\n')).toContain('Tool links reconciled');
  });

  it('shows additions and removals before asking for confirmation', async () => {
    const harness = makeHarness();
    harness.confirm.mockResolvedValue(true);
    harness.checkbox.mockResolvedValue(['codex']);

    await runListSession({}, deps(harness, ['@alice/code-review', 'tools', 'back', '__exit__']));

    const logs = harness.logs.join('\n');
    expect(logs).toContain('Will add: Codex');
    expect(logs).toContain('Will remove (ESL-managed only): Claude Code');
    expect(harness.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ tools: ['codex'] })
    );
  });

  it('makes no change when the reconciliation confirmation is rejected', async () => {
    const harness = makeHarness();
    harness.confirm.mockResolvedValue(false);
    harness.checkbox.mockResolvedValue(['codex']);

    await runListSession({}, deps(harness, ['@alice/code-review', 'tools', 'back', '__exit__']));

    expect(harness.reconcile).not.toHaveBeenCalled();
    expect(harness.logs.join('\n')).toContain('Tool link adjustment cancelled');
  });

  it('allows clearing the set and reconciles to no ESL-managed links', async () => {
    const harness = makeHarness();
    harness.confirm.mockResolvedValue(true);
    harness.checkbox.mockResolvedValue([]);

    await runListSession({}, deps(harness, ['@alice/code-review', 'tools', 'back', '__exit__']));

    expect(harness.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ identity: '@alice/code-review', tools: [] })
    );
  });

  it('reports a failed reconciliation without pretending links changed', async () => {
    const harness = makeHarness();
    harness.confirm.mockResolvedValue(true);
    harness.checkbox.mockResolvedValue(['codex']);
    harness.reconcile.mockResolvedValue({
      status: 'failed',
      ensured: [{ identity: '@alice/code-review', tool: 'codex', targetDir: '/x', status: 'conflict' }],
      removed: [],
      failures: [{ identity: '@alice/code-review', tool: 'codex', targetDir: '/x', status: 'conflict' }]
    });

    await runListSession({}, deps(harness, ['@alice/code-review', 'tools', 'back', '__exit__']));

    const logs = harness.logs.join('\n');
    expect(logs).toContain('Tool link reconciliation failed');
    expect(logs).toContain('existing links are kept');
    expect(logs).toContain('Codex: conflict');
  });

  it('refreshes the detail after a successful reconciliation', async () => {
    const harness = makeHarness();
    harness.confirm.mockResolvedValue(true);
    harness.checkbox.mockResolvedValue(['claude']);

    await runListSession({}, deps(harness, ['@alice/code-review', 'tools', 'back', '__exit__']));

    const calls = selectCalls(harness.select);
    expect(calls[2].message).toContain('@alice/code-review');
  });
});
