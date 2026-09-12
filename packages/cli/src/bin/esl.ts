#!/usr/bin/env node
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { readHidden, readStdinText } from '../prompt.js';
import { executeInfo, formatSkillInfo } from '../commands/info.js';
import { executeChangeOwnPassword } from '../commands/admin.js';
import { executeAdapt, formatAdaptResults } from '../commands/adapt.js';
import { executeSource } from '../commands/source.js';
import { executeList } from '../commands/list.js';
import { executeUse } from '../commands/use.js';
import { executeInit } from '../commands/init.js';
import { executeInstall } from '../commands/install.js';
import { executeLogin } from '../commands/login.js';
import { executeLogout, formatLogout } from '../commands/logout.js';
import { executeSetServer } from '../commands/config.js';
import { executeWhoami, formatWhoami } from '../commands/whoami.js';
import { executePublish } from '../commands/publish.js';
import { executeUpload } from '../commands/upload.js';
import { executeResetSource } from '../commands/reset-source.js';
import { executeStatus } from '../commands/status.js';
import { executeRename } from '../commands/rename.js';
import { executeNotes } from '../commands/notes.js';
import { executeRepairTag } from '../commands/repair-tag.js';
import { executeSearch } from '../commands/search.js';
import { executeShare } from '../commands/share.js';
import { executeUpdate } from '../commands/update.js';
import { executeUninstall } from '../commands/uninstall.js';
import { executeValidate } from '../commands/validate.js';
import { executeVersion } from '../commands/version.js';
import { readCliVersion } from '../version.js';
import { retryPendingGlobalSync } from '../commands/sync-builtin.js';

function example(text: string): string {
  return `\nExample:\n  ${text}\n`;
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function resolvePublishPositional(first: string | undefined, second: string | undefined): { path?: string; version?: string } {
  if (!first) {
    return {};
  }
  if (!second) {
    return SEMVER_PATTERN.test(first) ? { version: first } : { path: first };
  }
  return SEMVER_PATTERN.test(first) && !SEMVER_PATTERN.test(second)
    ? { version: first, path: second }
    : { path: first, version: second };
}

export function createProgram(): Command {
  const program = new Command();

  program.name('esl').description('Enterprise Skill Library CLI').version(readCliVersion());
  program.option('-d, --debug', 'print stack traces on error');
  program.option('--no-input', 'disable all prompts');

  program
    .command('init')
    .argument('<skill-name>')
    .option('--license <spdx>', 'release.json license (default MIT)')
    .addHelpText('after', example('$ esl init my-skill'))
    .action(async (skillName: string, options: { license?: string }) => {
      const targetDir = await executeInit(skillName, { license: options.license });
      console.log(`Skill initialized at ${targetDir}`);
    });

  program
    .command('login')
    .option('--username <username>', 'ESL username (defaults to the saved or prompted username)')
    .option('--org <orgname>', 'ESL organization (required; resolves the Gitea account as orgname_username)')
    .option('--server <url>', 'ESL Server URL (defaults to the saved server or ESL_SERVER)')
    .option('--password-file <path>', 'Read the ESL password from a file')
    .option('--token-file <path>', 'Read a Skill User Token from a file')
    .addHelpText('after', example('$ esl login --server http://localhost:3000 --org acme --username alice'))
    .action(async (options: { server?: string; username?: string; org?: string; passwordFile?: string; tokenFile?: string }) => {
      const login = await executeLogin({
        ...options,
        noInput: program.opts().input === false,
        readInput: process.stdin.isTTY ? undefined : () => readStdinText(),
        readServer: process.stdin.isTTY ? undefined : () => readStdinText(),
        readUsername: process.stdin.isTTY ? undefined : () => readStdinText(),
        readOrg: process.stdin.isTTY ? undefined : () => readStdinText()
      });
      // 用解析后的身份(org 可能由默认组织自动解析而非显式 --org)打印成功信息
      console.log(`Logged in as ${login.org ? `${login.org}/` : ''}${login.username}`);
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
    .argument('<query>')
    .option('--server <url>', 'ESL Server URL')
    .option('--json', 'Output as JSON')
    .addHelpText('after', example('$ esl search code-review'))
    .action(async (query: string, options: { server?: string; json?: boolean }) => {
      const results = await executeSearch(query, options);
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }
      for (const result of results) {
        console.log(`${result.name}\t${result.description}`);
      }
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
    .argument('[path]', 'skill directory (defaults to --directory or the current directory)')
    .option('--directory <path>', 'skill directory', process.cwd())
    .option('--license <spdx>', 'SPDX license for a missing release.json (default MIT)')
    .option('--message <text>', 'description of this upload, used as the source commit message')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl upload ./my-skill --message "fix: correct the regex"'))
    .action(async (skillPath: string | undefined, options: { directory: string; license?: string; message?: string; server?: string }) => {
      const uploaded = await executeUpload({
        ...options,
        directory: skillPath ?? options.directory,
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
    .argument('[path]', 'skill directory (defaults to --directory or the current directory)')
    .option('--directory <path>', 'skill directory', process.cwd())
    .option('--server <url>', 'ESL Server URL')
    .option('-f, --force', 'reset without confirmation')
    .addHelpText('after', example('$ esl reset-source ./my-skill --force'))
    .action(async (skillPath: string | undefined, options: { directory: string; server?: string; force?: boolean }) => {
      const result = await executeResetSource({
        directory: skillPath ?? options.directory,
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
    .option('--directory <path>', 'skill directory', process.cwd())
    .addHelpText('after', example('$ esl status'))
    .action(async (options: { directory: string }) => {
      const status = await executeStatus({ ...options });
      if (!status.serverHosted) {
        console.log('Not yet a server-hosted skill source; run "esl upload --directory ." to register it');
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
    .option('--team <name>', 'share with a team (keeps the team permission level)')
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
    .argument('[path]', 'skill directory (defaults to --directory or the current directory)')
    .argument('[version]', 'Skill Release SemVer for release.json sources (also accepted as the only argument)')
    .option('--directory <path>', 'skill directory', process.cwd())
    .option('--server <url>', 'ESL Server URL')
    .option('--visibility <visibility>', 'public or private')
    .option('--license <spdx>', 'SPDX license for a missing release.json (default MIT)')
    .option('--message <text>', 'release notes; defaults to the commits since the last release tag')
    .option('-f, --force', 'publish without confirmation')
    .addHelpText('after', example('$ esl publish ./my-skill 1.1.0 --message "fix: dead-link regex"'))
    .action(async (first: string | undefined, second: string | undefined, options: { directory: string; server?: string; visibility?: string; license?: string; message?: string; force?: boolean }) => {
      const { path: skillPath, version } = resolvePublishPositional(first, second);
      await executePublish({
        ...options,
        directory: skillPath ?? options.directory,
        version,
        noInput: program.opts().input === false
      });
      console.log('Skill published');
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
    .option('--ignore-compatibility', 'Install incompatible published packages')
    .option('--no-adapt', 'Skip automatic adapt after install')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl install @cnfox/code-review'))
    .action(async (nameOrPath: string | undefined, options: { version?: string; global?: boolean; adapt?: boolean; server?: string; ignoreCompatibility?: boolean }) => {
      if (!nameOrPath) {
        console.log('Restoring skills from .skills.json...');
        return;
      }
      const targetDir = await executeInstall(nameOrPath, { ...options, noAdapt: options.adapt === false });
      console.log(`Skill installed at ${targetDir}`);
    });

  program
    .command('adapt')
    .description('Sync installed skills to AI tool directories')
    .option('--global', 'Adapt global skills instead of project skills')
    .option('--prune', 'Remove manifest-owned stale adapted outputs')
    .option('--directory <path>', 'Project directory', process.cwd())
    .addHelpText('after', example('$ esl adapt'))
    .action(async (options: { global?: boolean; prune?: boolean; directory?: string }) => {
      const results = await executeAdapt(options);
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
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl update'))
    .action(async (skillName: string | undefined, options: { global?: boolean; server?: string }) => {
      const results = await executeUpdate({ ...options, skillName });
      if (results.length === 0) {
        console.log('All skills are up to date');
        return;
      }
      for (const result of results) {
        console.log(`${result.name}: ${result.from} -> ${result.to}`);
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
      await executeUninstall(skillName, options);
      console.log(`Skill ${skillName} uninstalled`);
    });

  program
    .command('validate')
    .argument('[path]', 'skill directory', process.cwd())
    .addHelpText('after', example('$ esl validate ./my-skill'))
    .action(async (directory: string) => {
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
    .argument('<release>', 'major, minor, patch, or an explicit SemVer (e.g. 1.2.3)')
    .addHelpText('after', example('$ esl version minor\n$ esl version 1.2.3'))
    .action(async (release: string) => {
      const version = await executeVersion(release);
      console.log(version);
    });

  return program;
}

export function formatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Error: ${message}\nRun with --debug for more detail.`;
}

async function run(argv: string[]): Promise<void> {
  const debug = argv.includes('-d') || argv.includes('--debug');

  process.on('SIGINT', () => {
    console.error('\nInterrupted');
    process.exit(130);
  });

  try {
    await retryPendingGlobalSync({});
    await createProgram().parseAsync(argv);
  } catch (error) {
    console.error(debug ? error : formatErrorMessage(error));
    process.exitCode = 1;
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
