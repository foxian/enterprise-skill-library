#!/usr/bin/env node
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { readHidden, readStdinText } from '../prompt.js';
import { executeInfo, formatSkillInfo } from '../commands/info.js';
import {
  executeBootstrapStatus,
  executeChangeOwnPassword,
  executeCreateUser,
  executeDisableUser,
  executeAdministratorAccountPasswordChange,
  executeIssueUserToken,
  executeSetUserPassword
} from '../commands/admin.js';
import { executeAdapt, formatAdaptResults } from '../commands/adapt.js';
import { executeSource } from '../commands/source.js';
import { executeList } from '../commands/list.js';
import { executeUse } from '../commands/use.js';
import { executeImport } from '../commands/import.js';
import { executeInit } from '../commands/init.js';
import { executeInstall } from '../commands/install.js';
import { executeLogin } from '../commands/login.js';
import { executeSetServer } from '../commands/config.js';
import { executeWhoami, formatWhoami } from '../commands/whoami.js';
import { executePublish } from '../commands/publish.js';
import { executeUpload } from '../commands/upload.js';
import { executeRename } from '../commands/rename.js';
import { executeRepairTag } from '../commands/repair-tag.js';
import { executeSearch } from '../commands/search.js';
import { executeUpdate } from '../commands/update.js';
import { executeUninstall } from '../commands/uninstall.js';
import { executeValidate } from '../commands/validate.js';
import { executeVersion } from '../commands/version.js';
import { readCliVersion } from '../version.js';
import { retryPendingGlobalSync } from '../commands/sync-builtin.js';

function example(text: string): string {
  return `\nExample:\n  ${text}\n`;
}

export function createProgram(): Command {
  const program = new Command();

  program.name('esl').description('Enterprise Skill Library CLI').version(readCliVersion());
  program.option('-d, --debug', 'print stack traces on error');
  program.option('--no-input', 'disable all prompts');

  program
    .command('init')
    .argument('<skill-name>')
    .addHelpText('after', example('$ esl init my-skill'))
    .action(async (skillName: string) => {
      const targetDir = await executeInit(skillName);
      console.log(`Skill initialized at ${targetDir}`);
    });

  program
    .command('login')
    .option('--username <username>', 'ESL username (defaults to the saved or prompted username)')
    .option('--server <url>', 'ESL Server URL (defaults to the saved server)')
    .option('--password-file <path>', 'Read the ESL password from a file')
    .option('--token-file <path>', 'Read a Skill User Token from a file')
    .addHelpText('after', example('$ esl login --server http://localhost:3000 --username alice'))
    .action(async (options: { server?: string; username?: string; passwordFile?: string; tokenFile?: string }) => {
      await executeLogin({
        ...options,
        noInput: program.opts().input === false,
        readInput: process.stdin.isTTY ? undefined : () => readStdinText(),
        readUsername: process.stdin.isTTY ? undefined : () => readStdinText()
      });
      console.log(`Logged in as ${options.username ?? 'you'}`);
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

  const admin = program.command('admin').description('Manage ESL platform administration');
  admin.addHelpText('after', example('$ esl admin user create alice'));

  const bootstrap = admin.command('bootstrap');
  bootstrap
    .command('status')
    .option('--server <url>', 'ESL Server URL')
    .action(async (options: { server?: string }) => {
      const status = await executeBootstrapStatus(options);
      console.log(status.ready ? 'Bootstrap ready' : 'Bootstrap not ready');
      if (status.gitea) console.log(`Gitea: ${status.gitea}`);
      if (status.adminToken) console.log(`Admin token: ${status.adminToken}`);
      if (status.repoOwner) console.log(`Repo owner: ${status.repoOwner}`);
    });

  const adminUser = admin.command('user');
  adminUser
    .command('create')
    .argument('<username>')
    .option('--server <url>', 'ESL Server URL')
    .option('--password-file <path>', 'Use a custom initial password from a file')
    .option('--random', 'Generate a random initial password')
    .addHelpText('after', example('$ esl admin user create alice'))
    .action(async (username: string, options: { server?: string; passwordFile?: string; random?: boolean }) => {
      const result = await executeCreateUser(username, options);
      console.log(`User ${username} created`);
      if (result.password) {
        console.log(`Initial password: ${result.password}`);
      }
    });

  adminUser
    .command('token')
    .argument('<username>')
    .option('--server <url>', 'ESL Server URL')
    .action(async (username: string, options: { server?: string }) => {
      const token = await executeIssueUserToken(username, options);
      console.log(token);
    });

  adminUser
    .command('disable')
    .argument('<username>')
    .option('--server <url>', 'ESL Server URL')
    .action(async (username: string, options: { server?: string }) => {
      await executeDisableUser(username, options);
      console.log(`User ${username} disabled`);
    });

  adminUser
    .command('set-password')
    .argument('<username>')
    .option('--server <url>', 'ESL Server URL')
    .option('--password-file <path>', 'Use a custom new password from a file')
    .option('--random', 'Generate a random new password')
    .addHelpText('after', example('$ esl admin user set-password alice'))
    .action(async (username: string, options: { server?: string; passwordFile?: string; random?: boolean }) => {
      const result = await executeSetUserPassword(username, options);
      console.log(`Password for ${username} reset`);
      if (result.password) {
        console.log(`New password: ${result.password}`);
      }
    });

  const account = admin.command('account').description('Manage the ESL administrator account');
  account
    .command('change-password')
    .description('Change the configured ESL administrator account password')
    .option('--password-file <path>', 'Read the new ESL administrator account password from a file')
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl admin account change-password --server http://localhost:3000'))
    .action(async (options: { passwordFile?: string; server?: string }) => {
      await executeAdministratorAccountPasswordChange({
        ...options,
        noInput: program.opts().input === false,
        readInput: process.stdin.isTTY ? undefined : () => readStdinText(),
        readPassword: readHidden
      });
      console.log('Administrator account password changed');
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
    .description('Upload a local skill as a server-hosted source')
    .option('--directory <path>', 'skill directory', process.cwd())
    .option('--server <url>', 'ESL Server URL')
    .addHelpText('after', example('$ esl upload --directory ./my-skill'))
    .action(async (options: { directory: string; server?: string }) => {
      const uploaded = await executeUpload(options);
      console.log(`Skill source uploaded: ${uploaded.name} (${uploaded.skillId})`);
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
    .argument('[version]', 'Skill Release SemVer for release.json sources')
    .option('--directory <path>', 'skill directory', process.cwd())
    .option('--server <url>', 'ESL Server URL')
    .option('--visibility <visibility>', 'public or private')
    .option('-f, --force', 'publish without confirmation')
    .addHelpText('after', example('$ esl publish'))
    .action(async (version: string | undefined, options: { directory: string; server?: string; visibility?: string; force?: boolean }) => {
      await executePublish({ ...options, version, noInput: program.opts().input === false });
      console.log('Skill published');
    });

  program
    .command('import')
    .description('Import an existing local skill directory into the current project')
    .argument('<path>', 'existing skill directory')
    .option('--namespace <namespace>', 'skill namespace', 'local')
    .option('--no-adapt', 'Skip automatic adapt after install')
    .addHelpText('after', example('$ esl import ./my-skill --namespace cnfox'))
    .action(async (sourcePath: string, options: { namespace?: string; adapt?: boolean }) => {
      const result = await executeImport(sourcePath, {
        namespace: options.namespace,
        noAdapt: options.adapt === false
      });
      console.log(`Skill ${result.skillName} imported at ${result.targetDir}`);
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
    .argument('<release>', 'major, minor, or patch')
    .addHelpText('after', example('$ esl version minor'))
    .action(async (release: string) => {
      if (release !== 'major' && release !== 'minor' && release !== 'patch') {
        console.error('release must be major, minor, or patch');
        process.exitCode = 1;
        return;
      }
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
