import psList from 'ps-list';
import notifier from 'node-notifier';
import config from './config.js';
import {
    gitAdd,
    gitCommit,
    gitPush,
    gitPull,
    hasChanges,
    getCurrentBranch,
    isRebaseInProgress,
    gitAbortRebase
} from './git.js';
import { log } from './logger.js';
import { enforceClientVersionGate } from './clientVersionGate.js';
import { setProcessState, clearProcessState, updateLastSync } from './state.js';

let wasRunning = false;
let lastSyncTime = Date.now();
let repoIssueActive = false;

async function checkZen() {
    const list = await psList();
    const isRunning = list.find(p => {
        const name = p.name.toLowerCase();
        // Check for 'zen', 'zen.exe', 'zen-bin'
        return name === 'zen' || name === 'zen.exe' || name === 'zen-bin' || name.includes('zen browser');
    });
    return !!isRunning;
}

async function ensureRepoReady(repoPath, notify = false) {
    const shouldAnnounce = !repoIssueActive;

    if (await isRebaseInProgress(repoPath)) {
        if (shouldAnnounce) {
            log('⚠️ Detected interrupted git rebase. Attempting auto-recovery...', 'warning');
        }

        const aborted = await gitAbortRebase(repoPath);
        if (aborted.success) {
            if (shouldAnnounce) {
                log('✅ Rebase aborted safely. Sync will retry on next cycle.', 'warning');
            }
        } else if (shouldAnnounce) {
            log(`❌ Failed to abort rebase: ${aborted.error}`, 'error');
        }

        if (notify && shouldAnnounce) {
            notifier.notify({
                title: 'ZenSync',
                message: 'Git rebase got stuck. ZenSync attempted auto-recovery. Check logs.',
                wait: true
            });
        }

        repoIssueActive = true;
        return false;
    }

    const branch = await getCurrentBranch(repoPath);
    if (branch) {
        repoIssueActive = false;
        return true;
    }

    if (shouldAnnounce) {
        log('❌ Git is in detached HEAD state. Run: git checkout <your-main-branch>', 'error');
    }

    if (notify && shouldAnnounce) {
        notifier.notify({
            title: 'ZenSync',
            message: 'Git is in detached HEAD state. Check logs for recovery steps.',
            wait: true
        });
    }

    repoIssueActive = true;
    return false;
}

function isLikelyProfileLockError(errorText = '') {
    const text = errorText.toLowerCase();
    return (
        text.includes('unable to unlink old') ||
        text.includes('could not reset --hard') ||
        text.includes('invalid argument') ||
        text.includes('device or resource busy') ||
        text.includes('index.lock')
    );
}

let lockIssueActive = false;
let versionGateIssueActive = false;

async function performSync(repoPath, message, notify = true) {
    try {
        if (!(await ensureRepoReady(repoPath, notify))) {
            return false;
        }

        // Pull first to avoid piling up local commits if remote changed.
        const pullResult = await gitPull(repoPath);
        if (!pullResult.success) {
            if (isLikelyProfileLockError(pullResult.error)) {
                if (!lockIssueActive) {
                    log('⚠️ Sync temporarily blocked: profile files are locked by Zen. Will retry automatically.', 'warning');
                }
                lockIssueActive = true;
            } else {
                lockIssueActive = false;
                log(`❌ Pull failed: ${pullResult.error}`, 'error');
                if (notify) {
                    notifier.notify({
                        title: 'ZenSync',
                        message: 'Could not pull latest cloud changes. Check logs.',
                        wait: true
                    });
                }
            }

            await ensureRepoReady(repoPath, false);
            return false;
        }

        if (lockIssueActive) {
            log('✅ Profile lock cleared. Sync resumed.', 'success');
            lockIssueActive = false;
        }

        const versionGate = await enforceClientVersionGate(repoPath);
        if (!versionGate.ok) {
            if (!versionGateIssueActive) {
                log(`⛔ Sync blocked by ZenSync version gate: ${versionGate.reason}`, 'error');
                notifier.notify({
                    title: 'ZenSync',
                    message: 'Update required before this machine can push. Check logs for details.',
                    wait: true
                });
            }
            versionGateIssueActive = true;
            return false;
        }

        if (versionGateIssueActive) {
            log('✅ ZenSync version requirement satisfied. Sync resumed.', 'success');
            versionGateIssueActive = false;
        }

        await gitAdd(repoPath);
        if (!(await hasChanges(repoPath))) {
            log('No changes found.', 'info');
            return true;
        }

        const commitResult = await gitCommit(repoPath, message);
        if (!commitResult.success) {
            log(`❌ Commit failed: ${commitResult.error}`, 'error');
            notifier.notify({
                title: 'ZenSync',
                message: 'Hiccup! 🐸\nCommit failed. Check logs.',
                wait: true
            });
            return false;
        }

        const pushResult = await gitPush(repoPath);
        if (pushResult.success) {
            log('✅ Synced to cloud.', 'success');
            if (notify) notifier.notify({ title: 'ZenSync', message: 'Zen Mode: Synchronized! 🧘✨' });
            updateLastSync(Date.now());
            return true;
        }

        log(`❌ Push failed: ${pushResult.error}`, 'error');
        notifier.notify({
            title: 'ZenSync',
            message: 'Cloud seems a bit foggy? ☁️\nCheck logs or internet.',
            wait: true
        });
    } catch (error) {
        log(`Sync warning: ${error.message}`, 'warning');

        let msg = 'Hiccup! 🐸\nCheck \'zensync logs\' for details.';
        if (error.message.includes('index.lock')) {
            msg = 'Uh-oh, a little tangle! 🧶\nRun: rm .git/index.lock';
        } else if (error.message.includes('network') || error.message.includes('resolve host')) {
            msg = 'Cloud seems a bit foggy? ☁️\nCheck internet & try again.';
        }

        notifier.notify({
            title: 'ZenSync',
            message: msg,
            wait: true
        });
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

    // Handle exit — clean up state on any termination
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
    // Safety net: on Windows, SIGTERM doesn't fire — ensure state is always cleaned
    process.on('exit', () => {
        clearProcessState();
    });

    // Initial pull
    const initialPull = await gitPull(repoPath);
    if (!initialPull.success) {
        log(`⚠️ Initial pull failed: ${initialPull.error}`, 'warning');
        await ensureRepoReady(repoPath, false);
    }

    while (true) {
        // Update heartbeat
        setProcessState(process.pid, 'running');

        if (!(await ensureRepoReady(repoPath, false))) {
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }

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
            const idlePull = await gitPull(repoPath);
            if (!idlePull.success && idlePull.error.includes('rebase')) {
                await ensureRepoReady(repoPath, false);
            }
        }

        // Check every 5s
        await new Promise(r => setTimeout(r, 5000));
    }
}
