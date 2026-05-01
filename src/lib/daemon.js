import { spawn, execSync } from 'child_process';
import process from 'process';
import psList from 'ps-list';
import { getProcessState, setProcessState, clearProcessState } from './state.js';
import chalk from 'chalk';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function isAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function isWatcherProcess(proc) {
    const cmd = String(proc?.cmd || '').toLowerCase();
    const name = String(proc?.name || '').toLowerCase();

    if (!cmd && !name) return false;

    // Typical command patterns:
    // node .../bin/zensync watch
    // node .../@gustavonline/zen-sync/src/cli.js watch
    const mentionsZenSync =
        cmd.includes(' zensync ') ||
        cmd.includes('/zensync ') ||
        cmd.includes('\\zensync ') ||
        cmd.includes('@gustavonline/zen-sync') ||
        cmd.includes('@gustavonline/zensync') ||
        (cmd.includes('/src/cli.js') && cmd.includes('watch'));

    const mentionsWatch = cmd.includes(' watch');
    const nodeLike = name.includes('node') || cmd.includes(' node ');

    return mentionsZenSync && mentionsWatch && nodeLike;
}

export async function findRunningWatcherPids() {
    const processes = await psList();
    const pids = processes
        .filter(isWatcherProcess)
        .map(proc => proc.pid)
        .filter(Boolean)
        .filter(pid => pid !== process.pid);

    return [...new Set(pids)];
}

async function terminatePidGracefully(pid) {
    try {
        if (process.platform === 'win32') {
            try {
                execSync(`taskkill /PID ${pid}`, { stdio: 'ignore' });
            } catch {
                execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
            }
        } else {
            process.kill(pid, 'SIGTERM');
        }
    } catch {
        // Process may already be gone.
    }
}

function terminatePidForcefully(pid) {
    try {
        if (process.platform === 'win32') {
            execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        } else {
            process.kill(pid, 'SIGKILL');
        }
    } catch {
        // Process may already be gone.
    }
}

export async function startDaemon(options = {}) {
    const { force = false, silent = false } = options;

    const runningPids = await findRunningWatcherPids();
    if (runningPids.length > 0 && !force) {
        setProcessState(runningPids[0], 'running');
        if (!silent) {
            console.log(chalk.yellow(`ZenSync watcher is already running (PID: ${runningPids.join(', ')})`));
        }
        return false;
    }

    if (runningPids.length > 0 && force) {
        await stopDaemon({ all: true, silent: true });
    }

    const subprocess = spawn(process.argv[0], [process.argv[1], 'watch'], {
        detached: true,
        stdio: 'ignore'
    });

    subprocess.unref();
    setProcessState(subprocess.pid, 'running');

    if (!silent) {
        console.log(chalk.green(`Started ZenSync watcher in background (PID: ${subprocess.pid})`));
    }
    return true;
}

export async function stopDaemon(options = {}) {
    const { all = true, silent = false } = options;
    const { pid: statePid } = getProcessState();

    const runningPids = all ? await findRunningWatcherPids() : [];
    const pids = [...new Set([statePid, ...runningPids].filter(Boolean).filter(pid => pid !== process.pid))];

    if (pids.length === 0) {
        clearProcessState();
        if (!silent) console.log(chalk.yellow('No running watcher found.'));
        return 0;
    }

    for (const pid of pids) {
        await terminatePidGracefully(pid);
    }

    await delay(800);

    const survivors = pids.filter(isAlive);
    for (const pid of survivors) {
        terminatePidForcefully(pid);
    }

    clearProcessState();

    if (!silent) {
        if (survivors.length > 0) {
            console.log(chalk.green(`Stopped ZenSync watcher(s) (${pids.length} process(es), forced ${survivors.length}).`));
        } else {
            console.log(chalk.green(`Stopped ZenSync watcher(s) (${pids.length} process(es)).`));
        }
    }

    return pids.length;
}

export async function getDaemonStatus() {
    const state = getProcessState();
    const runningPids = await findRunningWatcherPids();
    const statePidAlive = state.pid ? isAlive(state.pid) : false;

    const isRunning = runningPids.length > 0 || statePidAlive;
    const primaryPid = runningPids[0] || (statePidAlive ? state.pid : undefined);

    if (!isRunning) {
        clearProcessState();
    }

    return {
        ...state,
        pid: primaryPid,
        isRunning,
        watcherPids: runningPids
    };
}
