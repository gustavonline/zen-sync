import psList from 'ps-list';
import notifier from 'node-notifier';
import config from './config.js';
import { gitAdd, gitCommit, gitPush, gitPull, hasChanges } from './git.js';
import { log } from './logger.js';
import { setProcessState, clearProcessState, updateLastSync } from './state.js';

let wasRunning = false;
let lastSyncTime = Date.now();

async function checkZen() {
    const list = await psList();
    const isRunning = list.find(p => {
        const name = p.name.toLowerCase();
        // Check for 'zen', 'zen.exe', 'zen-bin'
        return name === 'zen' || name === 'zen.exe' || name === 'zen-bin' || name.includes('zen browser');
    });
    return !!isRunning;
}

async function performSync(repoPath, message, notify = true) {
    try {
        await gitAdd(repoPath);
        if (await hasChanges(repoPath)) {
            const committed = await gitCommit(repoPath, message);
            if (committed) {
                // Pull remote changes to avoid conflicts if device was asleep/offline
                await gitPull(repoPath);
                
                const pushed = await gitPush(repoPath);
                if (pushed) {
                    log('✅ Synced to cloud.', 'success');
                    if (notify) notifier.notify({ title: 'ZenSync', message: 'Profile synced!' });
                    updateLastSync(Date.now());
                    return true;
                } else {
                    log('❌ Push failed.', 'error');
                    if (notify) notifier.notify({ title: 'ZenSync', message: 'Sync failed.' });
                }
            }
        } else {
            log('No changes found.', 'info');
        }
    } catch (error) {
        log(`Sync warning: ${error.message}`, 'warning');
    }
    return false;
}

export async function watch() {
    const repoPath = config.get('repoPath') || process.cwd();
    const autoSyncInterval = config.get('autoSyncInterval') || 0; // Minutes

    log(`Watcher started in ${repoPath}`);
    if (autoSyncInterval > 0) {
        log(`🔄 Auto-Sync enabled: Every ${autoSyncInterval} minutes.`);
    } else {
        log('Auto-Sync disabled (Syncs on close only).');
    }

    // Set initial state
    setProcessState(process.pid, 'running');

    // Handle exit
    process.on('SIGTERM', () => {
        log('Watcher stopping (SIGTERM)...');
        clearProcessState();
        process.exit(0);
    });
    process.on('SIGINT', () => {
        log('Watcher stopping (SIGINT)...');
        clearProcessState();
        process.exit(0);
    });

    // Initial pull
    await gitPull(repoPath);

    while (true) {
        // Update heartbeat
        setProcessState(process.pid, 'running');

        const isRunning = await checkZen();

        if (isRunning) {
            if (!wasRunning) {
                log('Zen Browser STARTED. Sync paused (unless Auto-Sync is on).');
                wasRunning = true;
            }

            // Continuous Sync Logic
            if (autoSyncInterval > 0) {
                const now = Date.now();
                const diffMinutes = (now - lastSyncTime) / 1000 / 60;
                
                if (diffMinutes >= autoSyncInterval) {
                    log(`⏳ Running Auto-Sync (${autoSyncInterval}m interval)...`);
                    await performSync(repoPath, `Auto-Sync (Live): ${new Date().toLocaleString()}`, false);
                    lastSyncTime = now;
                }
            }

        } else {
            if (wasRunning) {
                log('Zen Browser CLOSED. Syncing...');
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
