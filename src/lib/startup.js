import fs from 'fs';
import path from 'path';
import os from 'os';
import { execa } from 'execa';
import chalk from 'chalk';

const APP_NAME = 'com.gustavonline.zensync';
const WIN_SHORTCUT_NAME = 'ZenSync.lnk';

const LEGACY_FILES = {
    darwin: [
        'com.gustav.zen-sync.plist', // From old install_mac.sh
        'zensync.plist'
    ],
    win32: [
        // Add any old shortcut names here if known
    ]
};

function getStartupPath() {
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'LaunchAgents', `${APP_NAME}.plist`);
    } else if (process.platform === 'win32') {
        return path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', WIN_SHORTCUT_NAME);
    } else if (process.platform === 'linux') {
        return path.join(os.homedir(), '.config', 'systemd', 'user', 'zensync.service');
    }
    return null;
}

async function cleanupLegacy() {
    const platform = process.platform;
    if (!LEGACY_FILES[platform]) return;

    for (const file of LEGACY_FILES[platform]) {
        let legacyPath;
        if (platform === 'darwin') {
            legacyPath = path.join(os.homedir(), 'Library', 'LaunchAgents', file);
        } else if (platform === 'win32') {
            legacyPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', file);
        }

        if (legacyPath && fs.existsSync(legacyPath)) {
            console.log(chalk.yellow(`Removing legacy startup file: ${file}`));
            try {
                if (platform === 'darwin') {
                    await execa('launchctl', ['unload', legacyPath]).catch(() => {});
                }
                fs.unlinkSync(legacyPath);
            } catch (e) {
                console.error(chalk.red(`Failed to remove legacy file ${file}:`), e.message);
            }
        }
    }
}

export async function enableStartup() {
    await cleanupLegacy();
    const startupPath = getStartupPath();
    if (!startupPath) {
        console.log(chalk.red('Startup configuration is only supported on macOS, Windows, and Linux.'));
        return;
    }

    const nodePath = process.execPath;
    // Resolve real path of the CLI script
    const scriptPath = fs.realpathSync(process.argv[1]);
    
    // Check if we are pointing to the 'zensync' bin or 'cli.js'
    // If 'zensync' bin (symlink), we want to use that directly if possible, OR
    // stick to "node script" pattern which is safer cross-platform.
    // We will use "node /path/to/src/cli.js watch"
    
    // Ensure we are pointing to src/cli.js
    let targetScript = scriptPath;
    if (!scriptPath.endsWith('cli.js')) {
        // Try to find src/cli.js relative to package root if possible
        // But simpler is to assume user is running this setup from the repo or installed package
        // Let's rely on process.argv[1] which usually resolves correctly for node apps
    }

    console.log(chalk.blue('Configuring startup...'));

    if (process.platform === 'darwin') {
        const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${APP_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${targetScript}</string>
        <string>watch</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/zensync.out.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/zensync.err.log</string>
</dict>
</plist>`;

        fs.writeFileSync(startupPath, plistContent);
        
        try {
            await execa('launchctl', ['unload', startupPath]).catch(() => {}); // Ignore error if not loaded
            await execa('launchctl', ['load', startupPath]);
            console.log(chalk.green(`✅ Enabled startup! (Plist: ${startupPath})`));
        } catch (e) {
            console.error(chalk.red('Failed to load launch agent:'), e.message);
        }

    } else if (process.platform === 'win32') {
        // 1. Create a persistent VBS script that launches Node hidden
        // We place it in the 'scripts' folder at the repo root
        // targetScript is .../src/cli.js → dirname is .../src → .. is repo root
        const scriptsDir = path.join(path.dirname(targetScript), '..', 'scripts');
        
        if (!fs.existsSync(scriptsDir)) {
            fs.mkdirSync(scriptsDir, { recursive: true });
        }
        
        const launcherPath = path.join(scriptsDir, 'launch-silent.vbs');
        const launcherContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${nodePath}"" ""${targetScript}"" watch", 0, False
`;
        fs.writeFileSync(launcherPath, launcherContent);

        // 2. Create the Startup Shortcut pointing to the VBS launcher
        // Use wscript.exe to run the .vbs file (which runs Node hidden)
        const vbsScript = path.join(os.tmpdir(), 'create_shortcut.vbs');
        const vbsContent = `
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "${startupPath}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "wscript.exe"
oLink.Arguments = """${launcherPath}"""
oLink.WorkingDirectory = "${path.dirname(targetScript)}"
oLink.Description = "ZenSync Auto-Start"
oLink.Save
`;
        fs.writeFileSync(vbsScript, vbsContent);
        
        try {
            await execa('cscript', ['//Nologo', vbsScript]);
            console.log(chalk.green(`✅ Enabled startup! (Hidden Mode)`));
            console.log(chalk.gray(`  Shortcut: ${startupPath}`));
            console.log(chalk.gray(`  Launcher: ${launcherPath}`));
        } catch (e) {
            console.error(chalk.red('Failed to create shortcut:'), e.message);
        } finally {
            if (fs.existsSync(vbsScript)) fs.unlinkSync(vbsScript);
        }
    } else if (process.platform === 'linux') {
        fs.mkdirSync(path.dirname(startupPath), { recursive: true });

        const serviceContent = `[Unit]
Description=ZenSync background watcher

[Service]
Type=simple
ExecStart=${nodePath} ${targetScript} watch
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;

        fs.writeFileSync(startupPath, serviceContent);

        try {
            await execa('systemctl', ['--user', 'daemon-reload']);
            await execa('systemctl', ['--user', 'enable', '--now', 'zensync.service']);
            console.log(chalk.green(`✅ Enabled startup! (systemd user service)`));
            console.log(chalk.gray(`  Service: ${startupPath}`));
        } catch (e) {
            console.error(chalk.red('Failed to enable systemd user service:'), e.message);
            console.log(chalk.gray('Try manually: systemctl --user enable --now zensync.service'));
        }
    }
}

export async function disableStartup() {
    await cleanupLegacy();
    const startupPath = getStartupPath();
    if (startupPath && fs.existsSync(startupPath)) {
        if (process.platform === 'darwin') {
            try {
                await execa('launchctl', ['unload', startupPath]);
            } catch (e) {}
        } else if (process.platform === 'linux') {
            try {
                await execa('systemctl', ['--user', 'disable', '--now', 'zensync.service']);
            } catch (e) {}
        }
        fs.unlinkSync(startupPath);
        if (process.platform === 'linux') {
            try {
                await execa('systemctl', ['--user', 'daemon-reload']);
            } catch (e) {}
        }
        console.log(chalk.green('✅ Disabled startup.'));
    } else {
        console.log(chalk.yellow('Startup was not enabled.'));
    }
}
