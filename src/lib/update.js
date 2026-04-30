import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import notifier from 'node-notifier';
import { execa } from 'execa';
import config from './config.js';
import state from './state.js';
import { getDaemonStatus, stopDaemon, startDaemon } from './daemon.js';
import { isStartupEnabled } from './startup.js';
import { log } from './logger.js';

export const NPM_PACKAGE_NAME = '@gustavonline/zen-sync';
export const UPDATE_COMMAND = `npm install -g ${NPM_PACKAGE_NAME}`;
export const UPDATE_AND_RESTART_COMMAND = `${UPDATE_COMMAND} && zensync restart`;

const DEFAULT_UPDATE_CHECK_INTERVAL_HOURS = 6;

function npmCommand() {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function zensyncCommand() {
    return process.platform === 'win32' ? 'zensync.cmd' : 'zensync';
}

function getToolRoot() {
    const currentFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(currentFile), '..', '..');
}

export function readCurrentPackage() {
    try {
        const packagePath = path.join(getToolRoot(), 'package.json');
        return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    } catch {
        return { name: NPM_PACKAGE_NAME, version: '0.0.0' };
    }
}

export function readCurrentVersion() {
    return readCurrentPackage().version || '0.0.0';
}

function parseSemver(input = '0.0.0') {
    const [major = '0', minor = '0', patch = '0'] = String(input).split('.');
    return [major, minor, patch].map(part => {
        const numeric = Number.parseInt(String(part).replace(/\D.*$/, ''), 10);
        return Number.isFinite(numeric) ? numeric : 0;
    });
}

export function compareSemver(a, b) {
    const pa = parseSemver(a);
    const pb = parseSemver(b);

    for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return 1;
        if (pa[i] < pb[i]) return -1;
    }
    return 0;
}

function parseJsonString(value) {
    const text = String(value || '').trim();
    if (!text) return null;

    try {
        const parsed = JSON.parse(text);
        return typeof parsed === 'string' ? parsed : null;
    } catch {
        return text.replace(/^"|"$/g, '');
    }
}

async function queryLatestVersionViaView() {
    const { stdout } = await execa(npmCommand(), ['view', NPM_PACKAGE_NAME, 'version', '--json'], {
        timeout: 20_000
    });
    return parseJsonString(stdout);
}

async function queryLatestVersionViaDistTag() {
    const { stdout } = await execa(npmCommand(), ['dist-tag', 'ls', NPM_PACKAGE_NAME], {
        timeout: 20_000
    });

    const latestLine = stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => line.startsWith('latest:'));

    return latestLine ? latestLine.replace(/^latest:\s*/, '').trim() : null;
}

export async function getLatestPublishedVersion() {
    try {
        const latest = await queryLatestVersionViaView();
        if (latest) return { success: true, version: latest };
    } catch (error) {
        // npm's package document can briefly 404 right after first publish while
        // dist-tags are already visible. Fall back to dist-tag parsing.
        try {
            const latest = await queryLatestVersionViaDistTag();
            if (latest) return { success: true, version: latest };
        } catch (fallbackError) {
            return {
                success: false,
                error: fallbackError.stderr || fallbackError.shortMessage || fallbackError.message || 'Could not check npm registry'
            };
        }

        return {
            success: false,
            error: error.stderr || error.shortMessage || error.message || 'Could not check npm registry'
        };
    }

    return { success: false, error: 'npm registry did not return a latest version' };
}

function getUpdateCheckIntervalMs() {
    const configuredHours = config.get('updateCheckIntervalHours') ?? DEFAULT_UPDATE_CHECK_INTERVAL_HOURS;
    const hours = Number.isFinite(configuredHours) && configuredHours > 0
        ? configuredHours
        : DEFAULT_UPDATE_CHECK_INTERVAL_HOURS;
    return hours * 60 * 60 * 1000;
}

export async function checkForUpdates(options = {}) {
    const { force = false } = options;
    const currentVersion = readCurrentVersion();
    const now = Date.now();
    const lastCheckAt = state.get('update.lastCheckAt') || 0;
    const cachedLatest = state.get('update.latestVersion');

    if (!force && cachedLatest && now - lastCheckAt < getUpdateCheckIntervalMs()) {
        return {
            success: true,
            checked: false,
            cached: true,
            currentVersion,
            latestVersion: cachedLatest,
            updateAvailable: compareSemver(cachedLatest, currentVersion) > 0
        };
    }

    const latest = await getLatestPublishedVersion();
    state.set('update.lastCheckAt', now);

    if (!latest.success) {
        state.set('update.lastError', latest.error);
        return {
            success: false,
            checked: true,
            currentVersion,
            latestVersion: cachedLatest || null,
            updateAvailable: cachedLatest ? compareSemver(cachedLatest, currentVersion) > 0 : false,
            error: latest.error
        };
    }

    state.set('update.latestVersion', latest.version);
    state.delete('update.lastError');

    return {
        success: true,
        checked: true,
        currentVersion,
        latestVersion: latest.version,
        updateAvailable: compareSemver(latest.version, currentVersion) > 0
    };
}

export async function notifyIfUpdateAvailable() {
    const result = await checkForUpdates();
    if (!result.success || !result.updateAvailable) return result;

    const alreadyNotified = state.get('update.notifiedVersion') === result.latestVersion;
    if (alreadyNotified) return result;

    const message = `ZenSync ${result.latestVersion} is available. Run: zensync update`;
    const manual = `Manual update: ${UPDATE_COMMAND}`;

    log(`⬆️ ${message}. ${manual}`, 'warning');
    notifier.notify({
        title: 'ZenSync update available',
        message: `${message}\n${manual}`,
        wait: true
    });

    state.set('update.notifiedVersion', result.latestVersion);
    return result;
}

function formatNpmOutput(result) {
    return (result.all || result.stdout || result.stderr || '').trim();
}

async function runNpmInstall(force = false) {
    const args = ['install', '-g', NPM_PACKAGE_NAME];
    if (force) args.push('--force');

    return await execa(npmCommand(), args, {
        all: true,
        reject: false,
        timeout: 5 * 60 * 1000
    });
}

async function runInstalledZensync(args) {
    return await execa(zensyncCommand(), args, {
        all: true,
        reject: false,
        timeout: 60_000
    });
}

export async function runSelfUpdate(options = {}) {
    const { force = false, checkOnly = false } = options;
    const currentVersion = readCurrentVersion();

    console.log(chalk.bold('ZenSync update'));
    console.log(chalk.gray(`Current version: ${currentVersion}`));

    const updateCheck = await checkForUpdates({ force: true });
    if (!updateCheck.success) {
        console.log(chalk.yellow(`Could not check npm registry: ${updateCheck.error}`));
        if (checkOnly) return false;
        console.log(chalk.gray(`Continuing with reinstall command: ${UPDATE_COMMAND}`));
    } else {
        console.log(chalk.gray(`Latest version:  ${updateCheck.latestVersion}`));

        if (!updateCheck.updateAvailable && !force) {
            console.log(chalk.green('✅ ZenSync is already up to date.'));
            console.log(chalk.gray(`Manual command: ${UPDATE_COMMAND}`));
            return true;
        }
    }

    if (checkOnly) {
        const available = updateCheck.success && updateCheck.updateAvailable;
        console.log(available
            ? chalk.yellow(`⬆️ Update available. Run: zensync update`)
            : chalk.green('✅ No update available.'));
        if (available) console.log(chalk.gray(`Manual command: ${UPDATE_COMMAND}`));
        return updateCheck.success;
    }

    const daemonStatus = getDaemonStatus();
    const wasRunning = daemonStatus.isRunning;
    const startupWasEnabled = isStartupEnabled();

    if (wasRunning) {
        console.log(chalk.blue('Stopping background watcher before update...'));
        stopDaemon();
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(chalk.blue(`Running: ${UPDATE_COMMAND}${force ? ' --force' : ''}`));
    let installResult = await runNpmInstall(force);
    let output = formatNpmOutput(installResult);

    if (installResult.exitCode !== 0 && !force && /EEXIST|file already exists/i.test(output)) {
        console.log(chalk.yellow('Existing zensync command detected. Retrying with --force to replace old shim/link...'));
        installResult = await runNpmInstall(true);
        output = formatNpmOutput(installResult);
    }

    if (output) console.log(output);

    if (installResult.exitCode !== 0) {
        console.log(chalk.red('❌ npm update failed.'));
        console.log(chalk.gray(`Try manually: ${UPDATE_COMMAND} --force`));
        if (wasRunning) {
            console.log(chalk.yellow('Restarting previous watcher...'));
            startDaemon();
        }
        return false;
    }

    state.set('update.lastCheckAt', 0);
    state.delete('update.notifiedVersion');

    if (startupWasEnabled) {
        console.log(chalk.blue('Refreshing launch-on-login to point at the updated package...'));
        const startupResult = await runInstalledZensync(['startup']);
        const startupOutput = formatNpmOutput(startupResult);
        if (startupOutput) console.log(startupOutput);
        if (startupResult.exitCode !== 0) {
            console.log(chalk.yellow('Could not refresh startup automatically. Run: zensync startup'));
        }
    }

    if (wasRunning) {
        console.log(chalk.blue('Starting updated background watcher...'));
        const startResult = await runInstalledZensync(['start']);
        const startOutput = formatNpmOutput(startResult);
        if (startOutput) console.log(startOutput);
        if (startResult.exitCode !== 0) {
            console.log(chalk.yellow('Could not start via global zensync command. Falling back to current process...'));
            startDaemon();
        }
    }

    console.log(chalk.green('✅ ZenSync update complete.'));
    console.log(chalk.gray('Check with: zensync --version && zensync status'));
    return true;
}
