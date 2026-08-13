#!/usr/bin/env node
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { executeInfo, formatSkillInfo } from '../commands/info.js';
import {
  executeBootstrapStatus,
  executeCreateUser,
  executeDisableUser,
  executeGiteaPasswordChange,
  executeIssueUserToken
} from '../commands/admin.js';
import { executeAdapt, formatAdaptResults } from '../commands/adapt.js';
import { executeSource } from '../commands/source.js';
import { executeList } from '../commands/list.js';
import { executeUse } from '../commands/use.js';
import { executeImport } from '../commands/import.js';
import { executeInit } from '../commands/init.js';
import { executeInstall } from '../commands/install.js';
import { executeLogin } from '../commands/login.js';
import { executePublish } from '../commands/publish.js';
import { executeSearch } from '../commands/search.js';
import { executeUpdate } from '../commands/update.js';
import { executeUninstall } from '../commands/uninstall.js';
import { executeValidate } from '../commands/validate.js';
import { executeVersion } from '../commands/version.js';
import { readCliVersion } from '../version.js';

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
    .requiredOption('--registry <url>', 'API Server base URL')
    .requiredOption('--git-base <url>', 'Gitea Git HTTP base URL')
    .requiredOption('--username <username>', 'Gitea username')
    .option('--password-file <path>', 'Read the Gitea password from a file')
    .option('--token-file <path>', 'Read a Gitea personal access token from a file')
    .addHelpText('after', example('$ esl login --registry http://localhost:3000/api --git-base http://localhost:3001 --username alice'))
    .action(async (options: { registry: string; gitBase: string; username: string; passwordFile?: string; tokenFile?: string }) => {
      await executeLogin({ ...options, noInput: program.opts().input === false });
      console.log(`Logged in as ${options.username}`);
    });

  const admin = program.command('admin').description('Manage ESL platform administration');
  admin.addHelpText('after', example('$ esl admin user create alice'));

  const bootstrap = admin.command('bootstrap');
  bootstrap
    .command('status')
    .option('--registry <url>', 'API Server base URL')
    .action(async (options: { registry?: string }) => {
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
    .option('--registry <url>', 'API Server base URL')
    .action(async (username: string, options: { registry?: string }) => {
      await executeCreateUser(username, options);
      console.log(`User ${username} created`);
    });

  adminUser
    .command('token')
    .argument('<username>')
    .option('--registry <url>', 'API Server base URL')
    .action(async (username: string, options: { registry?: string }) => {
      const token = await executeIssueUserToken(username, options);
      console.log(token);
    });

  adminUser
    .command('disable')
    .argument('<username>')
    .option('--registry <url>', 'API Server base URL')
    .action(async (username: string, options: { registry?: string }) => {
      await executeDisableUser(username, options);
      console.log(`User ${username} disabled`);
    });

  admin
    .command('gitea')
    .command('password')
    .option('--password-file <path>', 'Read the new Gitea administrator password from a file')
    .option('--registry <url>', 'API Server base URL')
    .action(async (options: { passwordFile?: string; registry?: string }) => {
      await executeGiteaPasswordChange({ ...options, noInput: program.opts().input === false });
      console.log('Gitea password changed');
    });

  program
    .command('search')
    .argument('<query>')
    .option('--registry <url>', 'API Server base URL')
    .option('--json', 'Output as JSON')
    .addHelpText('after', example('$ esl search code-review'))
    .action(async (query: string, options: { registry?: string; json?: boolean }) => {
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
    .option('--registry <url>', 'API Server base URL')
    .option('--json', 'Output as JSON')
    .addHelpText('after', example('$ esl info @cnfox/code-review'))
    .action(async (skillName: string, options: { registry?: string; json?: boolean }) => {
      const info = await executeInfo(skillName, options);
      if (options.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }
      console.log(formatSkillInfo(info));
    });

  program
    .command('publish')
    .option('--directory <path>', 'skill directory', process.cwd())
    .option('--registry <url>', 'API Server base URL')
    .option('--git-base <url>', 'Gitea Git HTTP base URL')
    .option('--visibility <visibility>', 'public or private')
    .option('-f, --force', 'publish without confirmation')
    .addHelpText('after', example('$ esl publish'))
    .action(async (options: { directory: string; registry?: string; gitBase?: string; visibility?: string; force?: boolean }) => {
      await executePublish({ ...options, noInput: program.opts().input === false });
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
    .option('--no-adapt', 'Skip automatic adapt after install')
    .option('--registry <url>', 'API Server base URL')
    .option('--git-base <url>', 'Gitea Git HTTP base URL')
    .addHelpText('after', example('$ esl install @cnfox/code-review'))
    .action(async (nameOrPath: string | undefined, options: { version?: string; global?: boolean; adapt?: boolean; registry?: string; gitBase?: string }) => {
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
    .option('--registry <url>', 'API Server base URL')
    .option('--git-base <url>', 'Gitea Git HTTP base URL')
    .addHelpText('after', example('$ esl source @cnfox/code-review'))
    .action(async (skillName: string, target: string | undefined, options: { registry?: string; gitBase?: string }) => {
      const targetDir = await executeSource(skillName, { ...options, target });
      console.log(`Skill cloned to ${targetDir}`);
    });

  program
    .command('use')
    .description('Output a skill prompt without installing (pipe to an agent)')
    .argument('<name-or-path>', 'skill name (@namespace/skill) or local path')
    .option('--version <version>', 'version to use')
    .option('--registry <url>', 'API Server base URL')
    .option('--git-base <url>', 'Gitea Git HTTP base URL')
    .addHelpText('after', example('$ esl use @cnfox/code-review'))
    .action(async (nameOrPath: string, options: { version?: string; registry?: string; gitBase?: string }) => {
      const content = await executeUse(nameOrPath, options);
      process.stdout.write(content);
    });

  program
    .command('update')
    .description('Update installed skills to latest versions')
    .argument('[skill-name]', 'specific skill to update')
    .option('--global', 'Update global skills')
    .option('--registry <url>', 'API Server base URL')
    .option('--git-base <url>', 'Gitea Git HTTP base URL')
    .addHelpText('after', example('$ esl update'))
    .action(async (skillName: string | undefined, options: { global?: boolean; registry?: string; gitBase?: string }) => {
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
