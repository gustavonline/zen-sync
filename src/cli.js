#!/usr/bin/env node
import { program } from 'commander';
import chalk from 'chalk';
import { setup } from './lib/setup.js';
import { watch } from './lib/watch.js';

program
  .name('zensync')
  .description('Seamlessly sync your Zen Browser profile')
  .version('1.0.0');

program.command('setup')
  .description('Initialize ZenSync')
  .action(async () => {
    await setup();
  });

program.command('watch')
  .description('Start the sync daemon')
  .action(async () => {
    await watch();
  });

program.parse();
