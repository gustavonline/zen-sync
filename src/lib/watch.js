import psList from 'ps-list';
import chalk from 'chalk';
import notifier from 'node-notifier';
import config from './config.js';
import { gitAdd, gitCommit, gitPush, gitPull, hasChanges } from './git.js';

let wasRunning = false;
let lastSyncTime = Date.now();

async function checkZen() {
    const list = await psList();
    const isRunning = list.find(p => {
        const name = p.name.toLowerCase();
        return name === 'zen' || name === 'zen-bin' || name.includes('zen browser');
    });
    return !!isRunning;
}

async function performSync(repoPath, message, notify = true) {
    try {
        await gitAdd(repoPath);
        if (await hasChanges(repoPath)) {
            const committed = await gitCommit(repoPath, message);
            if (committed) {
                const pushed = await gitPush(repoPath);
                if (pushed) {
                    console.log(chalk.green('✅ Synced to cloud.'));
                    if (notify) notifier.notify({ title: 'ZenSync', message: 'Profile synced!' });
                    return true;
                } else {
                    console.log(chalk.red('❌ Push failed.'));
                    if (notify) notifier.notify({ title: 'ZenSync', message: 'Sync failed.' });
                }
            }
        } else {
            console.log(chalk.gray('No local changes to sync.'));
        }
    } catch (error) {
        console.error(chalk.yellow('Sync warning (Locked files?):'), error.message);
    }
    return false;
}

export async function watch() {
    const repoPath = config.get('repoPath') || process.cwd();
    const autoSyncInterval = config.get('autoSyncInterval') || 0; // Minutes

    console.log(chalk.blue(`Watcher started in ${repoPath}`));
    if (autoSyncInterval > 0) {
        console.log(chalk.magenta(`🔄 Auto-Sync enabled: Every ${autoSyncInterval} minutes.`));
    } else {
        console.log(chalk.gray('Auto-Sync disabled (Syncs on close only).'));
    }

    // Initial pull
    await gitPull(repoPath);

    while (true) {
        const isRunning = await checkZen();

        if (isRunning) {
            if (!wasRunning) {
                console.log(chalk.yellow('Zen Browser STARTED. Sync paused (unless Auto-Sync is on).'));
                wasRunning = true;
            }

            // Continuous Sync Logic
            if (autoSyncInterval > 0) {
                const now = Date.now();
                const diffMinutes = (now - lastSyncTime) / 1000 / 60;
                
                if (diffMinutes >= autoSyncInterval) {
                    console.log(chalk.magenta(`⏳ Running Auto-Sync (${autoSyncInterval}m interval)...`));
                    await performSync(repoPath, `Auto-Sync (Live): ${new Date().toLocaleString()}`, false);
                    lastSyncTime = now;
                }
            }

        } else {
            if (wasRunning) {
                console.log(chalk.green('Zen Browser CLOSED. Syncing...'));
                // Wait for locks
                await new Promise(r => setTimeout(r, 2000));
                
                await performSync(repoPath, `Auto-Sync: ${new Date().toLocaleString()}`, true);
                wasRunning = false;
                lastSyncTime = Date.now();
            }

            // Idle pull
            await gitPull(repoPath);
        }

        // Check every 5s
        await new Promise(r => setTimeout(r, 5000));
    }
}
