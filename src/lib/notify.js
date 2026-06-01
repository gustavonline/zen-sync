import notifier from 'node-notifier';
import { execa } from 'execa';
import { log } from './logger.js';

function escapeAppleScriptString(value = '') {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r?\n/g, '\\n');
}

async function notifyMacOS(options = {}) {
    const title = escapeAppleScriptString(options.title || 'ZenSync');
    const message = escapeAppleScriptString(options.message || '');

    if (!message) return;

    await execa('osascript', [
        '-e',
        `display notification "${message}" with title "${title}"`
    ], {
        reject: false,
        timeout: 10_000
    });
}

export function notify(options = {}) {
    if (process.platform === 'darwin') {
        // node-notifier uses a bundled terminal-notifier.app on macOS, which newer
        // macOS releases can warn about as outdated. Native AppleScript notifications
        // avoid the deprecated helper while keeping the same user-facing behavior.
        notifyMacOS(options).catch(error => {
            log(`⚠️ macOS notification failed: ${error.message}`, 'warning');
        });
        return;
    }

    notifier.notify(options);
}
