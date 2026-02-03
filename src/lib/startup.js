import fs from 'fs';
import path from 'path';
import os from 'os';
import { execa } from 'execa';
import chalk from 'chalk';

const APP_NAME = 'com.gustavonline.zensync';
const WIN_SHORTCUT_NAME = 'ZenSync.lnk';

function getStartupPath() {
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'LaunchAgents', `${APP_NAME}.plist`);
    } else if (process.platform === 'win32') {
        return path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', WIN_SHORTCUT_NAME);
    }
    return null;
}

export async function enableStartup() {
    const startupPath = getStartupPath();
    if (!startupPath) {
        console.log(chalk.red('Startup configuration is only supported on macOS and Windows.'));
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
        // Create VBS script to generate shortcut
        const vbsScript = path.join(os.tmpdir(), 'create_shortcut.vbs');
        const vbsContent = `
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "${startupPath}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "${nodePath}"
oLink.Arguments = "\"${targetScript}\" watch"
oLink.WorkingDirectory = "${path.dirname(targetScript)}"
oLink.Description = "ZenSync Auto-Start"
oLink.Save
`;
        fs.writeFileSync(vbsScript, vbsContent);
        
        try {
            await execa('cscript', ['//Nologo', vbsScript]);
            console.log(chalk.green(`✅ Enabled startup! (Shortcut: ${startupPath})`));
        } catch (e) {
            console.error(chalk.red('Failed to create shortcut:'), e.message);
        } finally {
            if (fs.existsSync(vbsScript)) fs.unlinkSync(vbsScript);
        }
    }
}

export async function disableStartup() {
    const startupPath = getStartupPath();
    if (startupPath && fs.existsSync(startupPath)) {
        if (process.platform === 'darwin') {
            try {
                await execa('launchctl', ['unload', startupPath]);
            } catch (e) {}
        }
        fs.unlinkSync(startupPath);
        console.log(chalk.green('✅ Disabled startup.'));
    } else {
        console.log(chalk.yellow('Startup was not enabled.'));
    }
}
