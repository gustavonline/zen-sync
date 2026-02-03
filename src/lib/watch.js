import psList from 'ps-list';
import chalk from 'chalk';
import notifier from 'node-notifier';
import config from './config.js';
import { gitAdd, gitCommit, gitPush, gitPull, hasChanges } from './git.js';

let wasRunning = false;

async function checkZen() {
    const list = await psList();
    // Match "zen", "zen-bin", "Zen Browser"
    const isRunning = list.find(p => {
        const name = p.name.toLowerCase();
        return name === 'zen' || name === 'zen-bin' || name.includes('zen browser');
    });
    return !!isRunning;
}

export async function watch() {
    const repoPath = config.get('repoPath') || process.cwd();
    console.log(chalk.blue(`Watcher started in ${repoPath}`));
    console.log(chalk.cyan('Waiting for Zen Browser...'));

    // Initial pull to be safe
    await gitPull(repoPath);

    while (true) {
        const isRunning = await checkZen();

        if (isRunning) {
            if (!wasRunning) {
                console.log(chalk.yellow('Zen Browser STARTED. Sync paused.'));
                wasRunning = true;
            }
        } else {
            if (wasRunning) {
                console.log(chalk.green('Zen Browser CLOSED. Syncing...'));
                // Give file locks time to release
                await new Promise(r => setTimeout(r, 2000));

                await gitAdd(repoPath);
                if (await hasChanges(repoPath)) {
                    const committed = await gitCommit(repoPath, `Auto-Sync: ${new Date().toLocaleString()}`);
                    if (committed) {
                        const pushed = await gitPush(repoPath);
                        if (pushed) {
                            console.log(chalk.green('✅ Synced to cloud.'));
                            notifier.notify({ title: 'ZenSync', message: 'Profile synced to cloud!' });
                        } else {
                            notifier.notify({ title: 'ZenSync', message: 'Sync failed. Check logs.' });
                        }
                    }
                } else {
                    console.log(chalk.gray('No local changes.'));
                }
                wasRunning = false;
            }

            // Idle pull
            // We capture errors silently in the loop
            await gitPull(repoPath);
        }

        // Wait 5s
        await new Promise(r => setTimeout(r, 5000));
    }
}
