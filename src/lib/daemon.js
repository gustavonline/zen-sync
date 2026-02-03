import { spawn } from 'child_process';
import process from 'process';
import { getProcessState, setProcessState, clearProcessState } from './state.js';
import chalk from 'chalk';

export function startDaemon() {
    const { pid } = getProcessState();
    
    if (pid) {
        try {
            process.kill(pid, 0); // Check if running
            console.log(chalk.yellow('ZenSync watcher is already running (PID: ' + pid + ')'));
            return;
        } catch (e) {
            // Stale PID
            clearProcessState();
        }
    }

    // Spawn detached process
    const subprocess = spawn(process.argv[0], [process.argv[1], 'watch'], {
        detached: true,
        stdio: 'ignore'
    });

    subprocess.unref();
    setProcessState(subprocess.pid, 'running');
    console.log(chalk.green('Started ZenSync watcher in background (PID: ' + subprocess.pid + ')'));
}

export function stopDaemon() {
    const { pid } = getProcessState();
    
    if (!pid) {
        console.log(chalk.yellow('No running watcher found.'));
        return;
    }

    try {
        process.kill(pid, 'SIGTERM');
        clearProcessState();
        console.log(chalk.green('Stopped ZenSync watcher.'));
    } catch (e) {
        console.log(chalk.red('Failed to stop watcher (maybe it was already closed?):'), e.message);
        clearProcessState();
    }
}

export function getDaemonStatus() {
    const state = getProcessState();
    let isRunning = false;

    if (state.pid) {
        try {
            process.kill(state.pid, 0);
            isRunning = true;
        } catch (e) {
            isRunning = false;
            clearProcessState(); // Cleanup stale
        }
    }

    return { ...state, isRunning };
}
