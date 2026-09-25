#!/usr/bin/env node
import { Command, Option } from 'commander';
import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { readHidden, readStdinText, readText, isInteractive } from '../prompt.js';
import {
  AgentInteractionRequiredError,
  loadConfig,
  SUPPORTED_TOOLS,
  assertNoDuplicateCommandParams,
  createAgentInteractionRequest,
  parseCommandParams,
  readOptionalStringArrayParam,
  readOptionalStringParam,
  resolveToolName,
  toAskUserQuestionPayload,
  type AgentInteractionField,
  type ToolName
} from '@esl/core';
import {
  DEFAULT_LOCALE,
  resolveLocale,
  SUPPORTED_LOCALES,
  translateApiError,
  type Locale
} from '@esl/i18n';
import { executeInfo, formatSkillInfo } from '../commands/info.js';
import { executeChangeOwnPassword } from '../commands/admin.js';
import { executeAdapt, formatAdaptResults } from '../commands/adapt.js';
import { executeSource } from '../commands/source.js';
import { executeList } from '../commands/list.js';
import { executeUse } from '../commands/use.js';
import { executeInit } from '../commands/init.js';
import { executeInstall, resolveDefaultInstallTools } from '../commands/install.js';
import { executeLink } from '../commands/link.js';
import { executeUnlink } from '../commands/unlink.js';
import { executeLogin } from '../commands/login.js';
import { executeLogout, formatLogout } from '../commands/logout.js';
import { executeSetServer } from '../commands/config.js';
import { executeWhoami, formatWhoami } from '../commands/whoami.js';
import { executePublish } from '../commands/publish.js';
import { executeDeprecate } from '../commands/deprecate.js';
import { executeReleaseDelete } from '../commands/release-delete.js';
import { executeUpload } from '../commands/upload.js';
import { executeResetSource } from '../commands/reset-source.js';
import { executeStatus } from '../commands/status.js';
import { executeRename } from '../commands/rename.js';
import { executeNotes } from '../commands/notes.js';
import { executeRepairTag } from '../commands/repair-tag.js';
import { executeSearch, type SkillSearchFilters, type SkillSearchResult } from '../commands/search.js';
import { executeShare } from '../commands/share.js';
import { executeUpdate } from '../commands/update.js';
import { executeUninstall } from '../commands/uninstall.js';
import { executeToolsList, executeToolsRemove, formatToolsList, parseToolsOption } from '../commands/tools.js';
import { executeValidate } from '../commands/validate.js';
import {
  executeVersion,
  inspectVersion,
  isValidExplicitVersion,
  nextVersion,
  type VersionInspection
} from '../commands/version.js';
import { readCliVersion } from '../version.js';
import { retryPendingGlobalSync } from '../commands/sync-builtin.js';

function example(text: string): string {
  return `\nExample:\n  ${text}\n`;
}

const SUPPORTED_AGENT_TOOL_NAMES = [
  'claude-code (alias: claude)',
  ...SUPPORTED_TOOLS.filter((tool) => tool !== 'claude')
].join(', ');

export async function promptToolSelection(
  selectTools: typeof checkbox = checkbox
): Promise<ToolName[]> {
  const selected = await selectTools<ToolName>({
    message: 'Select AI tools',
    choices: SUPPORTED_TOOLS.map((tool) => ({ name: tool, value: tool })),
    required: true
  });
  if (selected.length === 0) {
    throw new Error('No tools selected');
  }
  return selected;
}

export async function promptVersionSelection(
  inspection: VersionInspection,
  selectVersion: typeof select = select
): Promise<string> {
  const choices = inspection.currentVersion
    ? [
        {
          name: 'patch',
          value: 'patch',
          description: `${nextVersion(inspection.currentVersion, 'patch')} — 修复缺陷`
        },
        {
          name: 'minor',
          value: 'minor',
          description: `${nextVersion(inspection.currentVersion, 'minor')} — 兼容的新能力`
        },
        {
          name: 'major',
          value: 'major',
          description: `${nextVersion(inspection.currentVersion, 'major')} — 破坏性变更`
        },
        {
          name: 'custom',
          value: 'custom',
          description: '输入明确的 SemVer（例如 1.4.2）'
        }
      ]
    : [
        {
          name: 'custom',
          value: 'custom',
          description: '输入明确的 SemVer（例如 1.4.2）'
        }
      ];
  return selectVersion({
    message: 'Select release type',
    choices,
    default: inspection.currentVersion ? 'patch' : 'custom'
  });
}

// 可安装技能发现面（ADR-0049）：search TTY 会话的两步选择。
// 列表中「Adjust filters…」视觉置顶，default 高亮第一条技能；末项 Exit。
const SEARCH_ADJUST = '__adjust__';
const SEARCH_EXIT = '__exit__';

// 复用 executeSearch 的筛选契约；server 只用于本会话请求与安装命令回显。
export interface SearchSessionFilters extends SkillSearchFilters {
  server?: string;
}

export interface SearchSessionDeps {
  select?: typeof select;
  confirm?: typeof confirm;
  input?: typeof input;
  search?: (filters: SearchSessionFilters) => Promise<SkillSearchResult[]>;
  install?: (nameOrPath: string) => Promise<void>;
}

function searchChoiceLabel(skill: SkillSearchResult): string {
  const parts = [skill.name];
  if (skill.displayName && skill.displayName !== skill.skillName) parts.push(skill.displayName);
  if (skill.latestStableVersion) parts.push(`v${skill.latestStableVersion}`);
  if (skill.visibility) parts.push(`(${skill.visibility})`);
  return parts.join('  ');
}

function installCommandFor(skillName: string, server?: string): string {
  return `esl install ${skillName}${server ? ` --server ${server}` : ''}`;
}

function printSearchDetails(skill: SkillSearchResult, server?: string): void {
  console.log(`\n${skill.name}`);
  if (skill.displayName && skill.displayName !== skill.skillName) {
    console.log(`Display name: ${skill.displayName}`);
  }
  console.log(`Description: ${skill.description}`);
  if (skill.latestStableVersion) console.log(`Latest stable version: v${skill.latestStableVersion}`);
  if (skill.visibility) console.log(`Visibility: ${skill.visibility}`);
  console.log(`More: ${installCommandFor(skill.name, server)} (or "esl info ${skill.name}")`);
}

// 调整筛选：query / namespace / keyword / visibility 循环修改，Done 返回列表。
export async function adjustSearchFilters(
  filters: SearchSessionFilters,
  selectPrompt: typeof select = select,
  inputPrompt: typeof input = input
): Promise<SearchSessionFilters> {
  const next = { ...filters };
  for (;;) {
    const field = await selectPrompt({
      message: 'Adjust filters',
      choices: [
        { name: `Query: ${next.query ?? '(browse all)'}`, value: 'query' },
        { name: `Namespace: ${next.namespace ?? '(all)'}`, value: 'namespace' },
        { name: `Keyword: ${next.keyword ?? '(all)'}`, value: 'keyword' },
        { name: `Visibility: ${next.visibility ?? '(all)'}`, value: 'visibility' },
        { name: 'Done', value: 'done' }
      ]
    });
    if (field === 'done') return next;
    if (field === 'query') {
      const value = await inputPrompt({ message: 'Search query (empty to browse all)' });
      next.query = value.trim() || undefined;
    } else if (field === 'namespace') {
      const value = await inputPrompt({ message: 'Namespace (empty for all)' });
      next.namespace = value.trim() || undefined;
    } else if (field === 'keyword') {
      const value = await inputPrompt({ message: 'Keyword (empty for all)' });
      next.keyword = value.trim() || undefined;
    } else if (field === 'visibility') {
      const value = await selectPrompt({
        message: 'Visibility',
        choices: [
          { name: 'All', value: 'all' },
          { name: 'Public', value: 'public' },
          { name: 'Private', value: 'private' }
        ]
      });
      next.visibility = value === 'all' ? undefined : (value as 'public' | 'private');
    }
  }
}

export async function runSearchSession(
  program: Command,
  initialFilters: SearchSessionFilters,
  deps: SearchSessionDeps = {}
): Promise<void> {
  const selectPrompt = deps.select ?? select;
  const confirmPrompt = deps.confirm ?? confirm;
  const inputPrompt = deps.input ?? input;
  let filters = { ...initialFilters };
  const server = filters.server;
  const search =
    deps.search ?? ((filters: SearchSessionFilters) => executeSearch(filters.query, filters));
  const install = deps.install ?? ((nameOrPath: string) => installSkill(program, nameOrPath, { server }));

  for (;;) {
    const results = await search(filters);
    if (results.length === 0) {
      // 0 条结果不进入空技能列表，直接提供调整筛选或退出。
      const action = await selectPrompt({
        message: 'No skills match the current filters',
        choices: [
          { name: 'Adjust filters…', value: SEARCH_ADJUST },
          { name: 'Exit', value: SEARCH_EXIT }
        ]
      });
      if (action === SEARCH_EXIT) return;
      filters = await adjustSearchFilters(filters, selectPrompt, inputPrompt);
      continue;
    }

    // 同一次筛选结果在浏览、详情和确认拒绝之间复用，避免重复请求。
    for (;;) {
      const chosen = await selectPrompt({
        message: `Select a skill (${results.length} found)`,
        default: results[0].name,
        choices: [
          { name: 'Adjust filters…', value: SEARCH_ADJUST },
          ...results.map((skill) => ({
            name: searchChoiceLabel(skill),
            value: skill.name,
            description: skill.description
          })),
          { name: 'Exit', value: SEARCH_EXIT }
        ]
      });
      if (chosen === SEARCH_EXIT) return;
      if (chosen === SEARCH_ADJUST) break;

      const skill = results.find((entry) => entry.name === chosen)!;
      const action = await selectPrompt({
        message: chosen,
        choices: [
          { name: 'View details', value: 'details' },
          { name: 'Install', value: 'install' },
          { name: 'Back to list', value: 'back' }
        ]
      });
      if (action === 'details') {
        printSearchDetails(skill, server);
        continue;
      }
      if (action === 'back') continue;

      // 安装前回显完整命令并确认；拒绝则回到列表继续浏览。
      console.log(`\n$ ${installCommandFor(chosen, server)}`);
      const proceed = await confirmPrompt({ message: 'Run this install command?', default: false });
      if (!proceed) continue;
      await install(chosen);
      return;
    }
  }
}

export interface InstallCommandOptions {
  version?: string;
  global?: boolean;
  tools?: string | boolean;
  force?: boolean;
  adapt?: boolean;
  server?: string;
  ignoreCompatibility?: boolean;
}

// install 命令主体：search TTY 会话确认后也走同一条安装路径（含 tools 选择）。
export async function installSkill(
  program: Command,
  nameOrPath: string,
  options: InstallCommandOptions
): Promise<void> {
  const skipToolLinks = options.tools === false || options.adapt === false;
  let tools = skipToolLinks ? [] : parseToolsOption(options.tools as string | undefined);
  if (!skipToolLinks && tools.length === 0) {
    const configured = await resolveDefaultInstallTools(process.cwd(), {
      ...options,
      tools: undefined,
      global: options.global
    });
    if (configured.length === 0) {
      if (program.opts().input === false || !isInteractive()) {
        throw new Error('No tools configured; pass --tools or run interactively');
      }
      tools = await promptToolSelection();
    } else {
      tools = configured;
    }
  }

  const targetDir = await executeInstall(nameOrPath, {
    ...options,
    tools,
    noAdapt: skipToolLinks
  });
  console.log(`Skill installed at ${targetDir}`);
}

async function promptCustomVersion(): Promise<string> {
  while (true) {
    const version = await readText('Version (SemVer)');
    if (isValidExplicitVersion(version)) {
      return version;
    }
    console.error('Version must be valid SemVer (e.g. 1.2.3).');
  }
}

function versionAgentFields(inspection: VersionInspection): AgentInteractionField[] {
  if (!inspection.currentVersion) {
    return [
      {
        id: 'release',
        kind: 'text',
        label: 'Version',
        required: true
      }
    ];
  }

  return [
    {
      id: 'release',
      kind: 'select',
      label: 'Release type',
      required: true,
      default: 'patch',
      options: [
        {
          label: 'patch',
          description: `${nextVersion(inspection.currentVersion, 'patch')} — 修复缺陷`
        },
        {
          label: 'minor',
          description: `${nextVersion(inspection.currentVersion, 'minor')} — 兼容的新能力`
        },
        {
          label: 'major',
          description: `${nextVersion(inspection.currentVersion, 'major')} — 破坏性变更`
        }
      ]
    }
  ];
}

/** A bare SemVer in the publish path slot is a leftover `esl publish <version>` call, not a directory. */
const SEMVER_ARGUMENT_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const AGENT_INTERACTION_COMMANDS = new Set(['init', 'version']);
let activeLocale: Locale = DEFAULT_LOCALE;

export function createProgram(): Command {
  const program = new Command();

  program.name('esl').description('Enterprise Skill Library CLI').version(readCliVersion());
  program.option('-d, --debug', 'print stack traces on error');
  program.option('--no-input', 'disable all prompts');
  program.option('--agent-interaction', 'return structured interaction requests instead of prompting');
  program.option(
    '--agent-tool <tool>',
    'AI tool invoking the command, e.g. claude-code or codex (requires --agent-interaction)'
  );
  program.option('--locale <locale>', 'Use a temporary locale for this command (zh-CN or en-US)');
  program.option('--params-json <json>', 'pass command parameters as a JSON object');
  program.option('-C, --cd <path>', 'run the command in the given directory first, like npm -C');
  program.hook('preAction', async (_thisCommand, actionCommand) => {
    const options = program.opts<{
      cd?: string;
      paramsJson?: string;
      agentInteraction?: boolean;
      agentTool?: string;
      locale?: string;
    }>();
    if (
      options.locale !== undefined &&
      !(SUPPORTED_LOCALES as readonly string[]).includes(options.locale)
    ) {
      throw new Error(`Unsupported locale: ${options.locale}`);
    }
    try {
      const config = await loadConfig({});
      activeLocale = resolveLocale({ override: options.locale, accountLocale: config.locale });
    } catch {
      activeLocale = resolveLocale({ override: options.locale, accountLocale: null });
    }
    if (options.agentTool !== undefined && resolveToolName(options.agentTool) === undefined) {
      throw new Error(
        `Unknown agent tool: ${options.agentTool}. Supported tools: ${SUPPORTED_AGENT_TOOL_NAMES}`
      );
    }
    if (options.agentTool !== undefined && options.agentInteraction !== true) {
      throw new Error('--agent-tool requires --agent-interaction');
    }
    if (
      options.paramsJson !== undefined &&
      !AGENT_INTERACTION_COMMANDS.has(actionCommand.name())
    ) {
      throw new Error(`--params-json is not supported for ${actionCommand.name()}`);
    }
    if (
      options.agentInteraction === true &&
      !AGENT_INTERACTION_COMMANDS.has(actionCommand.name())
    ) {
      throw new Error(`--agent-interaction is not supported for ${actionCommand.name()}`);
    }

    const cd = options.cd;
    if (typeof cd === 'string' && cd.length > 0) {
      try {
        process.chdir(cd);
      } catch (error) {
        throw new Error(`Cannot change directory to ${cd}: ${(error as NodeJS.ErrnoException).message}`);
      }
    }
  });

  program
    .command('init')
    .argument('[path]', 'target skill directory (defaults to --cd or the current directory)')
    .option('--name <name>', 'skill short name (defaults to the target directory basename)')
    .option('--namespace <namespace>', 'release.json namespace: personal (default) or an organization')
    .option('--license <spdx>', 'release.json license (default MIT)')
    .option('--description <text>', 'SKILL.md description (asked interactively when omitted)')
    .option('--display-name <text>', 'release.json display name (defaults to a title-cased short name)')
    .option('--keywords <list>', 'comma-separated release.json keywords')
    .addHelpText('after', example('$ esl init ./markdown-master\n  $ esl init --name my-skill'))
    .action(
      async (
        skillPath: string | undefined,
        options: { name?: string; namespace?: string; license?: string; description?: string; displayName?: string; keywords?: string }
      ) => {
        const rawParamsJson = program.opts().paramsJson as string | undefined;
        const params = rawParamsJson
          ? parseCommandParams(rawParamsJson, 'init', ['name', 'namespace', 'license', 'description', 'display-name', 'keywords'])
          : {};
        assertNoDuplicateCommandParams(
          params,
          {
            name: options.name,
            namespace: options.namespace,
            license: options.license,
            description: options.description,
            'display-name': options.displayName,
            keywords: options.keywords
          },
          'init'
        );
        const name = readOptionalStringParam(params, 'name', 'init') ?? options.name;
        const namespace = readOptionalStringParam(params, 'namespace', 'init') ?? options.namespace;
        const license = readOptionalStringParam(params, 'license', 'init') ?? options.license;
        const description = readOptionalStringParam(params, 'description', 'init') ?? options.description;
        const displayName = readOptionalStringParam(params, 'display-name', 'init') ?? options.displayName;
        const keywords =
          readOptionalStringArrayParam(params, 'keywords', 'init') ??
          options.keywords
            ?.split(',')
            .map((keyword: string) => keyword.trim())
            .filter((keyword: string) => keyword.length > 0);
        const targetDir = await executeInit({
          directory: skillPath,
          name,
          namespace,
          license,
          description,
          displayName,
          keywords,
          noInput: program.opts().input === false,
          agentInteraction: program.opts().agentInteraction === true,
          agentTool:
            program.opts().agentTool === undefined
              ? undefined
              : resolveToolName(program.opts().agentTool as string)
        });
        console.log(`Skill initialized at ${targetDir}`);
      }
    );

  program
    .command('login')
    .option('--username <username>', 'ESL username (defaults to the saved or prompted username)')
    .option('--server <url>', 'ESL Server URL (defaults to the saved server or ESL_SERVER)')
    .option('--password-file <path>', 'Read the ESL password from a file')
    .option('--token-file <path>', 'Read a Skill User Token from a file')
    .addHelpText('after', example('$ esl login --server http://localhost:3000 --username alice'))
    .action(async (options: { server?: string; username?: string; passwordFile?: string; tokenFile?: string }) => {
      const login = await executeLogin({
        ...options,
        locale: program.opts().locale as string | undefined,
        noInput: program.opts().input === false,
        readInput: process.stdin.isTTY ? undefined : () => readStdinText(),
        readServer: process.stdin.isTTY ? undefined : () => readStdinText(),
        readUsername: process.stdin.isTTY ? undefined : () => readStdinText()
      });
      // 全局身份登录（ADR-0032）：一条凭据走遍个人空间与所有组织
      console.log(`Logged in as ${login.username}`);
    });

  program
    .command('logout')
    .description('Clear the locally stored ESL credentials')
    .addHelpText('after', example('$ esl logout'))
    .action(async () => {
      const result = await executeLogout();
      console.log(formatLogout(result));
    });

  const configCmd = program.command('config').description('Manage ESL client configuration');
  configCmd.addHelpText('after', example('$ esl config set-server http://localhost:3000'));
  configCmd
    .command('set-server')
    .description('Set the ESL Server URL used by all commands')
    .argument('<url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl config set-server http://localhost:3000'))
    .action(async (url: string) => {
      const { server } = await executeSetServer(url);
      console.log(`Server set to ${server}`);
    });

  program
    .command('whoami')
    .description('Show the current login and login status')
    .addHelpText('after', example('$ esl whoami'))
    .action(async () => {
      const result = await executeWhoami();
      console.log(formatWhoami(result));
    });

  const myAccount = program
    .command('account')
    .description('Manage your own ESL account');
  myAccount.addHelpText('after', example('$ esl account change-password'));
  myAccount
    .command('change-password')
    .description('Change your own ESL password')
    .option('--current-password-file <path>', 'Read the current ESL password from a file')
    .option('--password-file <path>', 'Read the new ESL password from a file')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl account change-password --server http://localhost:3000'))
    .action(async (options: { currentPasswordFile?: string; passwordFile?: string; server?: string }) => {
      await executeChangeOwnPassword({
        ...options,
        noInput: program.opts().input === false,
        readInput: process.stdin.isTTY ? undefined : () => readStdinText(),
        readPassword: readHidden
      });
      console.log('Password changed');
    });

  program
    .command('search')
    .argument('[query]', 'search query (omit to browse all visible published skills)')
    .option('--server <url>', 'ESL Server URL')
    .option('--namespace <namespace>', 'filter by namespace (org or user)')
    .option('--keyword <keyword>', 'hard filter by skill keyword')
    .addOption(
      new Option('--visibility <visibility>', 'filter by visibility').choices(['public', 'private'])
    )
    .option('--limit <count>', 'maximum number of results (default 50)')
    .option('--json', 'Output as JSON')
    .addHelpText('after', example('$ esl search code-review\n$ esl search'))
    .action(async (query: string | undefined, options: {
      server?: string;
      namespace?: string;
      keyword?: string;
      visibility?: 'public' | 'private';
      limit?: string;
      json?: boolean;
    }) => {
      let limit: number | undefined;
      if (options.limit !== undefined) {
        limit = Number(options.limit);
        if (!Number.isInteger(limit) || limit <= 0) {
          throw new Error('--limit must be a positive integer');
        }
      }
      const filters: SearchSessionFilters = {
        namespace: options.namespace,
        keyword: options.keyword,
        visibility: options.visibility,
        limit,
        server: options.server
      };
      // TTY（stdin+stdout 且未 --no-input/--json）才进入两步选择会话。
      if (program.opts().input === false || options.json || !isInteractive()) {
        const results = await executeSearch(query, { ...options, ...filters });
        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }
        if (results.length === 0) {
          console.log('No skills found.');
          return;
        }
        for (const result of results) {
          console.log(
            `${result.name}\t${result.displayName ?? result.skillName ?? ''}\t${result.latestStableVersion ?? ''}\t${result.visibility ?? ''}\t${result.description}`
          );
        }
        return;
      }
      await runSearchSession(program, { ...filters, query });
    });

  program
    .command('info')
    .argument('<skill-name>')
    .option('--server <url>', 'ESL Server URL')
    .option('--json', 'Output as JSON')
    .addHelpText('after', example('$ esl info @cnfox/code-review'))
    .action(async (skillName: string, options: { server?: string; json?: boolean }) => {
      const info = await executeInfo(skillName, options);
      if (options.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }
      console.log(formatSkillInfo(info));
    });

program
    .command('upload')
    .description('Commit, push and (on first use) register a local skill source')
    .argument('[path]', 'skill directory (defaults to --cd or the current directory)')
    .option('--license <spdx>', 'SPDX license for a missing release.json (default MIT)')
    .option('--message <text>', 'description of this upload, used as the source commit message')
    .option('--confirm-identity <skill-name>', 'confirm the first-upload skill identity for non-interactive use')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl upload ./my-skill --confirm-identity @acme/my-skill'))
    .action(async (skillPath: string | undefined, options: { license?: string; message?: string; confirmIdentity?: string; server?: string }) => {
      const uploaded = await executeUpload({
        ...options,
        directory: skillPath,
        noInput: program.opts().input === false
      });
      if ('alreadyUpToDate' in uploaded && uploaded.alreadyUpToDate) {
        console.log(`Skill source is already up to date: ${uploaded.name}`);
        return;
      }
      console.log(
        uploaded.skillId
          ? `Skill source uploaded: ${uploaded.name} (${uploaded.skillId})`
          : `Skill source synced: ${uploaded.name}`
      );
    });

  program
    .command('reset-source')
    .description('Detach a skill source directory from its server source (remove the esl remote and back up release.json)')
    .argument('[path]', 'skill directory (defaults to --cd or the current directory)')
    .option('--server <url>', 'ESL Server URL')
    .option('-f, --force', 'reset without confirmation')
    .addHelpText('after', example('$ esl reset-source ./my-skill --force'))
    .action(async (skillPath: string | undefined, options: { server?: string; force?: boolean }) => {
      const result = await executeResetSource({
        directory: skillPath,
        server: options.server,
        force: options.force,
        noInput: program.opts().input === false
      });
      console.log(`Source link reset in ${result.directory}; the directory is now a plain local skill source`);
      console.log('To register it as a fresh server source, run "esl upload" from the directory');
    });

  program
    .command('status')
    .description('Show the state of the local skill source vs the server')
    .argument('[path]', 'skill directory (defaults to --cd or the current directory)')
    .addHelpText('after', example('$ esl status'))
    .action(async (skillPath: string | undefined) => {
      const status = await executeStatus({ directory: skillPath });
      if (!status.serverHosted) {
        console.log('Not yet a server-hosted skill source; run "esl upload ." to register it');
        return;
      }
      const lines = [
        status.clean ? 'Working tree: clean' : 'Working tree: has uncommitted changes',
        `Local ahead of server: ${status.ahead} commit(s) not pushed`,
        `Local behind server: ${status.behind} commit(s)`
      ];
      if (status.lastCommit) {
        lines.push(`Last commit: ${status.lastCommit}`);
      }
      console.log(lines.join('\n'));
    });

  program
    .command('rename')
    .description('Rename a server-hosted skill')
    .argument('<skill-name>')
    .argument('<new-name>')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl rename @platform-ai/reviewer reviewer-pro'))
    .action(async (identity: string, newName: string, options: { server?: string }) => {
      const renamed = await executeRename(identity, { ...options, newName });
      console.log(`Skill renamed: ${(renamed as { name?: string }).name ?? newName}`);
    });

  program
    .command('share')
    .description('Share a skill with your organization, a team, or a member')
    .argument('<skill-name>')
    .option('--all', 'share with the whole organization (read; add --write for edit)')
    .option('--team <name>', 'share with a team (read; add --write or --manage)')
    .option('--user <username>', 'share with a member (read; add --write for edit; add --manage for co-management)')
    .option('--write', 'grant edit (write) permission where applicable')
    .option('--manage', 'grant manage permission (share, publish, and grant others)')
    .option('--reset', 'reset to private (only you keep access)')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl share @acme/code-review --all'))
    .action(async (identity: string, options: { all?: boolean; team?: string; user?: string; write?: boolean; manage?: boolean; reset?: boolean; server?: string }) => {
      await executeShare(identity, options);
      console.log('Skill sharing updated');
    });

  program
    .command('repair-tag')
    .description('Repair a missing release tag')
    .argument('<skill-name>')
    .argument('<version>')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl repair-tag @platform-ai/reviewer 1.0.0'))
    .action(async (identity: string, version: string, options: { server?: string }) => {
      const repaired = await executeRepairTag(identity, { ...options, version });
console.log(`Release tag repaired: ${(repaired as { tag?: string }).tag ?? `v${version}`}`);
    });

  program
    .command('publish')
    .argument('[path]', 'skill directory (defaults to --cd or the current directory)')
    .option('--server <url>', 'ESL Server URL')
    .option('--visibility <visibility>', 'public or private')
    .option('--license <spdx>', 'SPDX license for a missing release.json (default MIT)')
    .option('--message <text>', 'release notes; defaults to the commits since the last release tag')
    .option('-f, --force', 'publish without confirmation')
    .option('--dry-run', 'validate and preview the release without touching the server')
    .addHelpText('after', example('$ esl publish ./my-skill --message "fix: dead-link regex"'))
    .action(async (skillPath: string | undefined, options: { server?: string; visibility?: string; license?: string; message?: string; force?: boolean; dryRun?: boolean }) => {
      if (skillPath && SEMVER_ARGUMENT_PATTERN.test(skillPath)) {
        console.error(
          `esl publish no longer takes a version argument (got ${skillPath}). Run \`esl version <release>\` to set the version, then run esl publish.`
        );
        process.exitCode = 1;
        return;
      }
      await executePublish({
        ...options,
        directory: skillPath,
        noInput: program.opts().input === false
      });
      if (options.dryRun) {
        console.log('Dry run complete — no release was created.');
      } else {
        console.log('Skill published');
      }
    });

  program
    .command('deprecate')
    .description('Mark a published version as deprecated, or clear the mark')
    .argument('<skill-name>', 'scoped skill name, e.g. @acme/code-review')
    .argument('<version>', 'published version to deprecate')
    .option('--message <text>', 'warning shown to anyone installing this version; empty clears the mark', '')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl deprecate @acme/code-review 1.2.0 --message "Use 1.3.0 instead"'))
    .action(async (name: string, version: string, options: { message: string; server?: string }) => {
      await executeDeprecate(name, version, options);
      console.log(
        options.message.trim()
          ? `Marked ${name}@${version} as deprecated`
          : `Cleared the deprecation mark on ${name}@${version}`
      );
    });

  program
    .command('release-delete')
    .description('Delete a single published version (the version number is burned)')
    .argument('<skill-name>', 'scoped skill name, e.g. @acme/code-review')
    .argument('<version>', 'published version to delete')
    .requiredOption('--confirm <version>', 'echo the version to confirm the deletion')
    .option('--force', 'override the dependency-pinning guard (platform administrator only)')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl release-delete @acme/code-review 1.0.0 --confirm 1.0.0'))
    .action(async (name: string, version: string, options: { confirm: string; force?: boolean; server?: string }) => {
      const result = await executeReleaseDelete(name, version, options);
      const dependents = result.dependents?.length ? ` (was required by ${result.dependents.join(', ')})` : '';
      console.log(`Deleted ${name}@${version}${dependents}`);
    });

  program
    .command('notes')
    .description('Update the release notes of a published version')
    .argument('<skill-name>')
    .argument('<version>')
    .requiredOption('--message <text>', 'new release notes')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl notes @platform-ai/reviewer 1.1.0 --message "Revised notes"'))
    .action(async (identity: string, version: string, options: { message: string; server?: string }) => {
      const updated = await executeNotes(identity, version, options);
      console.log(`Release notes updated: ${updated.skillName} ${updated.version}`);
    });

  program
    .command('install')
    .argument('[name-or-path]', 'skill name (@namespace/skill) or local path')
    .option('--version <version>', 'version to install')
    .option('--global', 'Install to global skills directory')
    .option('--tools <tools>', 'AI tools to link, comma-separated or all')
    .option('--no-tools', 'Install the skill source without creating tool links')
    .option('-f, --force', 'Replace ESL-owned stale links')
    .option('--ignore-compatibility', 'Install incompatible published packages')
    .option('--no-adapt', 'Skip automatic tool links after install')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl install @cnfox/code-review --tools claude-code,codex'))
    .action(async (nameOrPath: string | undefined, options: { version?: string; global?: boolean; tools?: string | boolean; force?: boolean; adapt?: boolean; server?: string; ignoreCompatibility?: boolean }) => {
      if (!nameOrPath) {
        console.log('Restoring skills from the ESL install manifest...');
        return;
      }
      await installSkill(program, nameOrPath, options);
    });

  program
    .command('link')
    .description('Link a local skill directory into the store (symlink, like npm link)')
    .argument('[path]', 'local skill directory (defaults to --cd or the current directory)')
    .option('--global', 'Link to global skills directory')
    .option('--tools <tools>', 'AI tools to link, comma-separated or all')
    .option('--no-tools', 'Link the skill source without creating tool links')
    .option('--identity <identity>', 'Namespace or full identity for a bare release.json name')
    .option('-f, --force', 'Replace existing directory or stale link at the target')
    .addHelpText('after', example('$ esl link ./my-skill --global\\n  $ esl link ../draft-skill'))
    .action(async (skillPath: string | undefined, options: { global?: boolean; tools?: string | boolean; force?: boolean }) => {
      const sourcePath = skillPath ?? '.';
      const skipToolLinks = options.tools === false;
      let tools = skipToolLinks ? [] : parseToolsOption(options.tools as string | undefined);
      if (!skipToolLinks && tools.length === 0) {
        const configured = await resolveDefaultInstallTools(process.cwd(), {
          ...options,
          tools: undefined,
          global: options.global
        });
        if (configured.length === 0) {
          if (program.opts().input === false || !isInteractive()) {
            throw new Error('No tools configured; pass --tools or run interactively');
          }
          tools = await promptToolSelection();
        }
      }

      const targetDir = await executeLink(sourcePath, {
        ...options,
        tools,
        noTools: skipToolLinks
      });
      console.log('Linked skill at ' + targetDir);
    });

  program
    .command('adapt')
    .description('Ensure Tool Links for installed skills')
    .argument('[path]', 'project directory (defaults to --cd or the current directory)')
    .option('--global', 'Ensure global Tool Links instead of project links')
    .addHelpText('after', example('$ esl adapt'))
    .action(async (skillPath: string | undefined, options: { global?: boolean }) => {
      const results = await executeAdapt({ ...options, directory: skillPath });
      for (const line of formatAdaptResults(results)) {
        console.log(line);
      }
    });

  program
    .command('list')
    .alias('ls')
    .description('List installed skills')
    .option('--global', 'List global skills instead of project skills')
    .option('--json', 'Output as JSON')
    .addHelpText('after', example('$ esl list'))
    .action(async (options: { global?: boolean; json?: boolean }) => {
      const skills = await executeList(options);
      if (options.json) {
        console.log(JSON.stringify(skills, null, 2));
        return;
      }
      if (skills.length === 0) {
        console.log(options.global ? 'No global skills installed.' : 'No skills installed in this project.');
        return;
      }
      const label = options.global ? 'Global' : 'Project';
      console.log(`${label} skills (${skills.length} installed):`);
      for (const skill of skills) {
        const name = skill.name.padEnd(30);
        console.log(`  ${name} v${skill.version}   (${skill.source})`);
      }
    });

  const toolsCommand = program
    .command('tools')
    .description('Manage AI tool skill links')
    .addHelpText('after', example('$ esl tools list --tool claude-code,codex --managed'));
  toolsCommand
    .command('list')
    .description('List skills linked into AI tools')
    .option('--tool <tools>', 'filter by tool, comma-separated')
    .option('--skill <skills>', 'filter by skill identity, comma-separated')
    .option('--global', 'list global links instead of project links')
    .option('--project', 'list project links (the default)')
    .option('--managed', 'only ESL-managed links')
    .option('--unmanaged', 'only links ESL does not manage')
    .option('--status <statuses>', 'filter by status: linked,broken,conflict,source-only,unmanaged')
    .option('--json', 'output as JSON')
    .addHelpText('after', example('$ esl tools list --tool claude-code,codex --managed'))
    .action(async (options: { tool?: string; skill?: string; global?: boolean; project?: boolean; managed?: boolean; unmanaged?: boolean; status?: string; json?: boolean }) => {
      const entries = await executeToolsList(options);
      if (options.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }
      for (const line of formatToolsList(entries)) {
        console.log(line);
      }
    });

  toolsCommand
    .command('remove')
    .description('Remove ESL-managed links for a skill')
    .argument('<skill-name>', 'skill identity, e.g. @acme/review')
    .option('--tools <tools>', 'AI tools to unlink, comma-separated or all')
    .option('--global', 'remove global links instead of project links')
    .addHelpText('after', example('$ esl tools remove @acme/review --tools claude-code,cursor'))
    .action(async (skillName: string, options: { tools?: string; global?: boolean }) => {
      let tools = parseToolsOption(options.tools);
      if (tools.length === 0) {
        if (program.opts().input === false || !isInteractive()) {
          throw new Error('No tools selected; pass --tools or run interactively');
        }
        tools = await promptToolSelection();
      }

      const results = await executeToolsRemove(skillName, { ...options, tools });
      if (results.length === 0) {
        console.log(`No ESL-managed links found for ${skillName}`);
        return;
      }
      for (const result of results) {
        console.log(`${result.tool}: ${result.status} ${result.targetDir}`);
      }
    });

  program
    .command('source')
    .description('Clone skill source for development')
    .argument('<skill-name>')
    .argument('[target]', 'target directory')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl source @cnfox/code-review'))
    .action(async (skillName: string, target: string | undefined, options: { server?: string }) => {
      const targetDir = await executeSource(skillName, { ...options, target });
      console.log(`Skill cloned to ${targetDir}`);
    });

  program
    .command('use')
    .description('Output a skill prompt without installing (pipe to an agent)')
    .argument('<name-or-path>', 'skill name (@namespace/skill) or local path')
    .option('--version <version>', 'version to use')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl use @cnfox/code-review'))
    .action(async (nameOrPath: string, options: { version?: string; server?: string }) => {
      const content = await executeUse(nameOrPath, options);
      process.stdout.write(content);
    });

  program
    .command('update')
    .description('Update installed skills to latest versions')
    .argument('[skill-name]', 'specific skill to update')
    .option('--global', 'Update global skills')
    .option('--tools <tools>', 'Ensure links for these AI tools after updating')
    .option('-f, --force', 'Replace ESL-owned stale links')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl update'))
    .action(async (skillName: string | undefined, options: { global?: boolean; tools?: string; force?: boolean; server?: string }) => {
      const results = await executeUpdate({
        ...options,
        skillName,
        tools: parseToolsOption(options.tools)
      });
      if (results.length === 0) {
        console.log('All skills are up to date');
        return;
      }
      for (const result of results) {
        if (result.skipped === 'link') {
          console.log(`${result.name}: linked (skipped)`);
        } else {
          console.log(`${result.name}: ${result.from} -> ${result.to}`);
        }
      }
    });

  program
    .command('uninstall')
    .description('Remove an installed skill')
    .argument('<skill-name>')
    .option('--global', 'Uninstall from global skills directory')
    .option('-f, --force', 'uninstall without confirmation')
    .addHelpText('after', example('$ esl uninstall @cnfox/code-review'))
    .action(async (skillName: string, options: { global?: boolean }) => {
      const result = await executeUninstall(skillName, options);
      if (result.sourceRemoved) {
        console.log(`Skill ${skillName} uninstalled`);
      } else {
        console.log(`Skill ${skillName} uninstalled; linked source was preserved at ${result.sourcePath}`);
      }
    });

  program
    .command('unlink')
    .description('Unlink a local skill source and restore the previous store copy when staged')
    .argument(
      '[skill-name-or-path]',
      'skill identity (@scope/name), or a skill directory (defaults to --cd or the current directory)'
    )
    .option('--global', 'Unlink from global skills directory')
    .addHelpText(
      'after',
      example(
        '$ esl unlink @local/my-skill\n  $ esl unlink --global\n  $ esl unlink ./my-skill'
      ) +
        '\n\nProject-level path form must be run from the project root; omit-in-directory is for --global.'
    )
    .action(async (target: string | undefined, options: { global?: boolean }) => {
      const result = await executeUnlink(target, options);
      if (result.restored) {
        console.log(`Skill ${result.identity} unlinked; previous store copy restored at ${result.targetDir}`);
      } else {
        console.log(`Skill ${result.identity} unlinked`);
      }
    });

  program
    .command('validate')
    .argument('[path]', 'skill directory')
    .addHelpText('after', example('$ esl validate ./my-skill'))
    .action(async (directory: string | undefined) => {
      const result = await executeValidate(directory);
      if (result.valid) {
        console.log('Skill package is valid');
        return;
      }
      for (const error of result.errors) {
        console.error(error);
      }
      process.exitCode = 1;
    });

  program
    .command('version')
    .argument('[release]', 'major, minor, patch, or an explicit SemVer (e.g. 1.2.3)')
    .addHelpText('after', example('$ esl version minor\n$ esl version 1.2.3'))
    .action(async (release?: string) => {
      const rawParamsJson = program.opts().paramsJson as string | undefined;
      const params = rawParamsJson
        ? parseCommandParams(rawParamsJson, 'version', ['release'])
        : {};
      assertNoDuplicateCommandParams(params, { release }, 'version');
      release ??= readOptionalStringParam(params, 'release', 'version');

      if (!release) {
        if (program.opts().input === false) {
          throw new Error('Missing release; pass major, minor, patch, or an explicit SemVer');
        }
        if (program.opts().agentInteraction === true) {
          const inspection = await inspectVersion(process.cwd());
          throw new AgentInteractionRequiredError(
            createAgentInteractionRequest({
              command: 'version',
              fields: versionAgentFields(inspection),
              agentTool:
                program.opts().agentTool === undefined
                  ? undefined
                  : resolveToolName(program.opts().agentTool as string)
            })
          );
        }
        if (!isInteractive()) {
          throw new Error('Missing release; pass major, minor, patch, or an explicit SemVer');
        }
        const inspection = await inspectVersion(process.cwd());
        const selected = await promptVersionSelection(inspection);
        release = selected === 'custom' ? await promptCustomVersion() : selected;
      }
      const version = await executeVersion(release);
      console.log(version);
    });

  return program;
}

export function formatErrorMessage(error: unknown, locale: Locale = 'en-US'): string {
  const apiError = error as {
    code?: unknown;
    params?: Record<string, string>;
    message?: string;
    status?: unknown;
  };
  const message =
    typeof apiError.code === 'string'
      ? translateApiError({
          locale,
          code: apiError.code,
          params: apiError.params,
          fallback: apiError.message ?? 'The request failed'
        })
      : error instanceof Error
        ? error.message
        : String(error);
  const localizedMessage =
    apiError.status === 403
      ? `${message}\nThis skill may be maintained by another account or organization; log in with the maintaining organization ("esl login") and retry.`
      : message;
  return `Error: ${localizedMessage}\nRun with --debug for more detail.`;
}

function isPromptCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'ExitPromptError';
}

export async function run(argv: string[]): Promise<void> {
  const debug = argv.includes('-d') || argv.includes('--debug');
  const onSigint = () => {
    console.error('\nInterrupted');
    process.exit(130);
  };
  process.on('SIGINT', onSigint);

  try {
    await retryPendingGlobalSync({});
    await createProgram().parseAsync(argv);
  } catch (error) {
    if (error instanceof AgentInteractionRequiredError) {
      process.stdout.write(`${JSON.stringify(toAskUserQuestionPayload(error.request))}\n`);
      process.exitCode = 2;
      return;
    }
    if (isPromptCancellation(error)) {
      process.exitCode = 130;
      return;
    }
    console.error(debug ? error : formatErrorMessage(error, activeLocale));
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', onSigint);
  }
}

export function isDirectCliEntry(moduleUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) {
    return false;
  }
  return canonicalPath(fileURLToPath(moduleUrl)) === canonicalPath(argvPath);
}

function canonicalPath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

if (isDirectCliEntry(import.meta.url, process.argv[1])) {
  await run(process.argv);
}
