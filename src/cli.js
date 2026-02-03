#!/usr/bin/env node
import { program } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { setup } from './lib/setup.js';
import { watch } from './lib/watch.js';
import config from './lib/config.js';

program
  .name('zensync')
  .description('Seamlessly sync your Zen Browser profile')
  .version('1.0.0');

program.command('setup')
  .description('Initialize ZenSync')
  .option('-y, --yes', 'Skip prompts and use current directory')
  .action(async (options) => {
    await setup(options);
  });

program.command('config')
  .description('Configure ZenSync settings')
  .action(async () => {
    const answers = await inquirer.prompt([
        {
            type: 'number',
            name: 'interval',
            message: 'Auto-Sync Interval (minutes, 0 to disable):',
            default: config.get('autoSyncInterval') || 0
        }
    ]);
    config.set('autoSyncInterval', answers.interval);
    console.log(chalk.green('✅ Settings saved!'));
  });

program.command('watch')
  .description('Start the sync daemon')
  .action(async () => {
    await watch();
  });

program.parse();
