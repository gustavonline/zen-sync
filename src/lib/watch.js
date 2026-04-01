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
    hasUnmergedPaths,
    recoverUnmergedConflictState,
    isRebaseInProgress,
    gitAbortRebase,
    isUnmergedConflictError
} from './git.js';
import { log } from './logger.js';
import { enforceClientVersionGate } from './clientVersionGate.js';
import { setProcessState, clearProcessState, updateLastSync } from './state.js';

let wasRunning = false;
let lastSyncTime = Date.now();
let lastIdlePullAt = 0;
let repoIssueActive = false;
const IDLE_PULL_INTERVAL_MS = 60 * 1000;

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

    if (await hasUnmergedPaths(repoPath)) {
        if (shouldAnnounce) {
            log('⚠️ Detected unresolved git conflict state. Attempting automatic recovery...', 'warning');
        }

        const recovery = await recoverUnmergedConflictState(repoPath);
        if (recovery.success) {
            if (shouldAnnounce) {
                const location = recovery.recoveryDir ? ` (backup: ${recovery.recoveryDir})` : '';
                log(`✅ Cleared unresolved git conflict state${location}. Sync will retry shortly.`, 'warning');
            }
        } else if (shouldAnnounce) {
            log(`❌ Failed to recover unresolved git state: ${recovery.error}`, 'error');
        }

        if (notify && shouldAnnounce) {
            notifier.notify({
                title: 'ZenSync',
                message: recovery.success
                    ? 'Git conflict state was auto-recovered. Sync will retry.'
                    : 'Git conflict state could not be auto-recovered. Check logs.',
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
let lastVersionGateNotifyAt = 0;
const VERSION_GATE_NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;

async function ensureClientVersionAllowed(repoPath) {
    const versionGate = await enforceClientVersionGate(repoPath);
    if (!versionGate.ok) {
        const shouldAnnounce = !versionGateIssueActive;
        const shouldNotify =
            shouldAnnounce ||
            (Date.now() - lastVersionGateNotifyAt >= VERSION_GATE_NOTIFY_COOLDOWN_MS);

        if (shouldAnnounce) {
            log(`⛔ Sync blocked by ZenSync version gate: ${versionGate.reason}`, 'error');
        }

        if (shouldNotify) {
            const shortReason = versionGate.reason.length > 180
                ? `${versionGate.reason.slice(0, 177)}...`
                : versionGate.reason;

            notifier.notify({
                title: 'ZenSync update required',
                message: shortReason,
                wait: true
            });
            lastVersionGateNotifyAt = Date.now();
        }

        versionGateIssueActive = true;
        return false;
    }

    if (versionGateIssueActive) {
        log('✅ ZenSync version requirement satisfied. Sync resumed.', 'success');
    }

    versionGateIssueActive = false;
    return true;
}

async function performSync(repoPath, message, notify = true) {
    try {
        if (!(await ensureRepoReady(repoPath, notify))) {
            return false;
        }

        // Pull first to avoid piling up local commits if remote changed.
        const pullResult = await gitPull(repoPath);
        if (!pullResult.success) {
            if (isUnmergedConflictError(pullResult.error)) {
                await ensureRepoReady(repoPath, notify);
                return false;
            }

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

        lastIdlePullAt = Date.now();

        if (pullResult.recovered && pullResult.recoveryDir) {
            log(`🛟 Pull recovery moved conflicting untracked files to: ${pullResult.recoveryDir}`, 'warning');
        }

        if (lockIssueActive) {
            log('✅ Profile lock cleared. Sync resumed.', 'success');
            lockIssueActive = false;
        }

        if (!(await ensureClientVersionAllowed(repoPath))) {
            return false;
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

    // Initial pull (skip while Zen is running to avoid lock/conflict storms)
    const zenRunningAtStart = await checkZen();
    if (zenRunningAtStart) {
        wasRunning = true;
        log('Zen Browser already running on startup. Skipping initial pull for safety.', 'warning');
    } else {
        const initialPull = await gitPull(repoPath);
        if (!initialPull.success) {
            log(`⚠️ Initial pull failed: ${initialPull.error}`, 'warning');
            await ensureRepoReady(repoPath, false);
        } else {
            lastIdlePullAt = Date.now();
        }
    }

    while (true) {
        // Update heartbeat
        setProcessState(process.pid, 'running');

        if (!(await ensureRepoReady(repoPath, false))) {
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }

        if (!(await ensureClientVersionAllowed(repoPath))) {
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

            // Idle pull (throttled)
            const now = Date.now();
            if (now - lastIdlePullAt >= IDLE_PULL_INTERVAL_MS) {
                const idlePull = await gitPull(repoPath);
                lastIdlePullAt = now;

                if (!idlePull.success && (idlePull.error.includes('rebase') || isUnmergedConflictError(idlePull.error))) {
                    await ensureRepoReady(repoPath, false);
                }
            }
        }

        // Check every 5s
        await new Promise(r => setTimeout(r, 5000));
    }
}
