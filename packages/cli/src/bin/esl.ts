#!/usr/bin/env node
import { Command } from 'commander';
import { executeInit } from '../commands/init.js';
import { executeLogin } from '../commands/login.js';
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

if (import.meta.url === `file://${process.argv[1]}`) {
  await createProgram().parseAsync(process.argv);
}
