#!/usr/bin/env node
import { program } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { setup } from './lib/setup.js';
import { watch } from './lib/watch.js';
import { startDaemon, stopDaemon, getDaemonStatus } from './lib/daemon.js';
import { enableStartup, disableStartup } from './lib/startup.js';
import { readLogs, getLogPath, clearLogs } from './lib/logger.js';
import config from './lib/config.js';
import state from './lib/state.js';

program
  .name('zensync')
  .description('Seamlessly sync your Zen Browser profile')
  .version('2.2.0');

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
            message: 'Live checkpoint interval while Zen is open (minutes, 0 to disable):',
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
    console.log(chalk.white('Final Sync: On browser close'));
    console.log(chalk.white(`Live Checkpoints: ${interval > 0 ? interval + 'm' : 'Disabled'}`));
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
  .description('Fully uninstall ZenSync (restore profile, clear config, remove startup)')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(async (options) => {
    console.log(chalk.bold.red('\nZenSync Uninstall'));
    console.log(chalk.white('This will:'));
    console.log(chalk.gray('  1. Stop the daemon'));
    console.log(chalk.gray('  2. Remove startup hooks'));
    console.log(chalk.gray('  3. Unlink the Zen profile junction (restore backup if available)'));
    console.log(chalk.gray('  4. Clear config, state, and logs'));
    console.log('');

    if (!options.yes) {
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'Proceed with uninstall?',
        default: false
      }]);
      if (!confirm) {
        console.log(chalk.yellow('Uninstall cancelled.'));
        return;
      }
    }

    // 1. Stop daemon
    console.log(chalk.blue('\n[1/4] Stopping daemon...'));
    stopDaemon();
    console.log(chalk.green('  Done.'));

    // 2. Disable startup
    console.log(chalk.blue('[2/4] Removing startup hooks...'));
    await disableStartup();

    // 3. Unlink profile junction
    console.log(chalk.blue('[3/4] Unlinking Zen profile...'));
    try {
      const platform = process.platform;
      let profilesDir;
      if (platform === 'win32') {
        profilesDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Zen', 'Profiles');
      } else if (platform === 'darwin') {
        profilesDir = path.join(os.homedir(), 'Library', 'Application Support', 'zen', 'Profiles');
      }

      if (profilesDir && fs.existsSync(profilesDir)) {
        const items = fs.readdirSync(profilesDir, { withFileTypes: true });

        for (const item of items) {
          const fullPath = path.join(profilesDir, item.name);
          let lstat;
          try { lstat = fs.lstatSync(fullPath); } catch { continue; }

          if (lstat.isSymbolicLink() && (item.name.endsWith('Default (release)') || item.name.endsWith('.default-release'))) {
            console.log(chalk.gray(`  Removing junction: ${item.name}`));

            // Remove the junction/symlink
            if (platform === 'win32') {
              fs.rmdirSync(fullPath);
            } else {
              fs.unlinkSync(fullPath);
            }

            // Look for a backup to restore
            const backupPrefix = `backup_${item.name}_`;
            const backups = items
              .filter(b => b.name.startsWith(backupPrefix))
              .sort((a, b) => b.name.localeCompare(a.name)); // newest first

            if (backups.length > 0) {
              const backupPath = path.join(profilesDir, backups[0].name);
              console.log(chalk.gray(`  Restoring backup: ${backups[0].name}`));
              fs.renameSync(backupPath, fullPath);
              console.log(chalk.green('  Profile restored from backup.'));
            } else {
              console.log(chalk.yellow('  No backup found. Zen Browser will create a fresh profile on next launch.'));
            }
            break;
          }
        }
      } else {
        console.log(chalk.gray('  Profiles directory not found, skipping.'));
      }
    } catch (err) {
      console.error(chalk.red(`  Failed to unlink profile: ${err.message}`));
    }

    // 4. Clear config, state, and logs
    console.log(chalk.blue('[4/4] Clearing config, state, and logs...'));
    try {
      config.clear();
      state.clear();
      clearLogs();
      console.log(chalk.green('  Done.'));
    } catch (err) {
      console.error(chalk.red(`  Failed to clear data: ${err.message}`));
    }

    // Summary
    console.log(chalk.bold.green('\nZenSync has been uninstalled.'));
    console.log(chalk.white('\nManual steps remaining:'));
    console.log(chalk.gray('  1. Remove the global CLI link:'));
    console.log(chalk.cyan('     npm uninstall -g zensync'));
    console.log(chalk.gray('  2. Delete the repo folder if no longer needed:'));
    console.log(chalk.cyan(`     rm -rf ${process.cwd()}`));
    if (process.platform === 'win32') {
      console.log(chalk.gray('     (or just delete the folder in Explorer)'));
    }
  });

program.parse();
