#!/usr/bin/env node
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { executeInfo } from '../commands/info.js';
import { executeAdapt } from '../commands/adapt.js';
import { executeClone } from '../commands/clone.js';
import { executeInit } from '../commands/init.js';
import { executeInstall } from '../commands/install.js';
import { executeLogin } from '../commands/login.js';
import { executePublish } from '../commands/publish.js';
import { executeSearch } from '../commands/search.js';
import { executeValidate } from '../commands/validate.js';
import { executeVersion } from '../commands/version.js';

export function createProgram(): Command {
  const program = new Command();

  program.name('esl').description('Enterprise Skill Library CLI').version('0.1.0');

  program
    .command('init')
    .argument('<skill-name>')
    .action(async (skillName: string) => {
      const targetDir = await executeInit(skillName);
      console.log(`Skill initialized at ${targetDir}`);
    });

  program
    .command('login')
    .requiredOption('--registry <url>', 'API Server base URL')
    .requiredOption('--git-base <url>', 'Gitea Git HTTP base URL')
    .requiredOption('--username <username>', 'Gitea username')
    .option('--password <password>', 'Gitea password')
    .option('--token <token>', 'Gitea personal access token')
    .action(async (options: { registry: string; gitBase: string; username: string; password?: string; token?: string }) => {
      await executeLogin(options);
      console.log(`Logged in as ${options.username}`);
    });

  program
    .command('search')
    .argument('<query>')
    .option('--registry <url>', 'API Server base URL')
    .action(async (query: string, options: { registry?: string }) => {
      const results = await executeSearch(query, options);
      for (const result of results) {
        console.log(`${result.name}\t${result.description}`);
      }
    });

  program
    .command('info')
    .argument('<skill-name>')
    .option('--registry <url>', 'API Server base URL')
    .action(async (skillName: string, options: { registry?: string }) => {
      console.log(JSON.stringify(await executeInfo(skillName, options), null, 2));
    });

  program
    .command('publish')
    .option('--directory <path>', 'skill directory', process.cwd())
    .option('--registry <url>', 'API Server base URL')
    .option('--git-base <url>', 'Gitea Git HTTP base URL')
    .option('--token <token>', 'Gitea personal access token')
    .option('--visibility <visibility>', 'public or private')
    .action(async (options: { directory: string; registry?: string; gitBase?: string; token?: string; visibility?: string }) => {
      await executePublish(options);
      console.log('Skill published');
    });

  program
    .command('install')
    .argument('[name-or-path]', 'skill name (@scope/skill) or local path')
    .option('--version <version>', 'version to install')
    .option('--global', 'Install to global skills directory')
    .option('--no-adapt', 'Skip automatic adapt after install')
    .option('--registry <url>', 'API Server base URL')
    .option('--git-base <url>', 'Gitea Git HTTP base URL')
    .option('--token <token>', 'Gitea personal access token')
    .action(async (nameOrPath: string | undefined, options: { version?: string; global?: boolean; adapt?: boolean; registry?: string; gitBase?: string; token?: string }) => {
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
    .option('--directory <path>', 'Project directory', process.cwd())
    .action(async (options: { global?: boolean; directory?: string }) => {
      const results = await executeAdapt(options);
      for (const result of results) {
        console.log(`${result.tool}: ${result.skills.length} skill(s) synced`);
      }
    });

  program
    .command('clone')
    .description('Clone skill source for development')
    .argument('<skill-name>')
    .argument('[target]', 'target directory')
    .option('--registry <url>', 'API Server base URL')
    .option('--git-base <url>', 'Gitea Git HTTP base URL')
    .option('--token <token>', 'Gitea personal access token')
    .action(async (skillName: string, target: string | undefined, options: { registry?: string; gitBase?: string; token?: string }) => {
      const targetDir = await executeClone(skillName, { ...options, target });
      console.log(`Skill cloned to ${targetDir}`);
    });

  program
    .command('validate')
    .argument('[path]', 'skill directory', process.cwd())
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
  await createProgram().parseAsync(process.argv);
}
