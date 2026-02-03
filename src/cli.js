#!/usr/bin/env node
import { program } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { setup } from './lib/setup.js';
import { watch } from './lib/watch.js';
import { startDaemon, stopDaemon, getDaemonStatus } from './lib/daemon.js';
import { enableStartup, disableStartup } from './lib/startup.js';
import { readLogs, getLogPath, clearLogs } from './lib/logger.js';
import config from './lib/config.js';

program
  .name('zensync')
  .description('Seamlessly sync your Zen Browser profile')
  .version('2.0.0');

// --- Setup & Config ---

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

// --- Process Management ---

program.command('watch')
  .description('Start the sync daemon (Foreground)')
  .action(async () => {
    await watch();
  });

program.command('start')
  .description('Start the sync daemon (Background)')
  .action(() => {
    startDaemon();
  });

program.command('stop')
  .description('Stop the background daemon')
  .action(() => {
    stopDaemon();
  });

program.command('restart')
  .description('Restart the background daemon')
  .action(() => {
    stopDaemon();
    setTimeout(() => startDaemon(), 1000);
  });

program.command('status')
  .description('Check daemon status')
  .action(() => {
    const status = getDaemonStatus();
    console.log(chalk.bold('ZenSync Status:'));
    if (status.isRunning) {
        console.log(chalk.green('● Running') + ` (PID: ${status.pid})`);
        console.log(chalk.gray(`Last Heartbeat: ${new Date(status.lastHeartbeat).toLocaleString()}`));
    } else {
        console.log(chalk.red('● Stopped'));
    }
    
    if (status.lastSync) {
        console.log(chalk.blue(`Last Sync: ${new Date(status.lastSync).toLocaleString()}`));
    } else {
        console.log(chalk.gray('Last Sync: Never'));
    }

    const interval = config.get('autoSyncInterval');
    console.log(chalk.white(`Auto-Sync: ${interval > 0 ? interval + 'm' : 'Disabled'}`));
    console.log(chalk.white(`Repo Path: ${config.get('repoPath')}`));
  });

// --- Utils ---

program.command('logs')
  .description('View recent logs')
  .option('-n, --lines <number>', 'Number of lines', '20')
  .option('-c, --clear', 'Clear log file')
  .action((options) => {
    if (options.clear) {
        clearLogs();
        console.log(chalk.green('Logs cleared.'));
        return;
    }
    
    console.log(chalk.gray(`Log file: ${getLogPath()}`));
    const logs = readLogs(parseInt(options.lines));
    if (logs.length === 0) {
        console.log(chalk.gray('No logs found.'));
    } else {
        logs.forEach(line => console.log(line));
    }
  });

program.command('startup')
  .description('Enable auto-start on boot')
  .action(async () => {
    await enableStartup();
  });

program.command('uninstall')
  .description('Remove startup hooks and stop daemon')
  .action(async () => {
    stopDaemon();
    await disableStartup();
    console.log(chalk.yellow('Startup disabled and daemon stopped.'));
    console.log(chalk.white('To remove completely, delete the repo and run "npm uninstall -g zensync"'));
  });

program.parse();
