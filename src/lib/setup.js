import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import config from './config.js';

function getProfilesDir() {
    const platform = process.platform;
    if (platform === 'win32') {
        return path.join(os.homedir(), 'AppData', 'Roaming', 'Zen', 'Profiles');
    } else if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'zen', 'Profiles');
    }
    return null;
}

function getZenConfigDir() {
    const platform = process.platform;
    if (platform === 'win32') {
        return path.join(os.homedir(), 'AppData', 'Roaming', 'Zen');
    } else if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'zen');
    }
    return null;
}

/**
 * Parse profiles.ini to find the expected default profile folder name.
 * Returns the folder name (e.g. "dpxszndl.Default (release)") or null.
 */
function getExpectedProfileName() {
    const zenDir = getZenConfigDir();
    if (!zenDir) return null;

    const iniPath = path.join(zenDir, 'profiles.ini');
    if (!fs.existsSync(iniPath)) return null;

    const content = fs.readFileSync(iniPath, 'utf8');
    const lines = content.split(/\r?\n/);

    // Look for the Install section's Default= entry first (most reliable)
    for (const line of lines) {
        const match = line.match(/^Default=Profiles\/(.+)$/);
        if (match) return match[1];
    }

    // Fallback: look for Profile sections with "Default (release)" in the path
    for (const line of lines) {
        const match = line.match(/^Path=Profiles\/(.+Default \(release\).*)$/);
        if (match) return match[1];
    }

    return null;
}

function createJunction(targetPath, repoProfilePath) {
    const platform = process.platform;
    const type = platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(repoProfilePath, targetPath, type);
}

async function linkProfile(repoPath) {
    const platform = process.platform;
    const profilesDir = getProfilesDir();

    if (!profilesDir) {
        console.log(chalk.yellow('Skipping profile linking: Unsupported platform.'));
        return;
    }

    if (!fs.existsSync(profilesDir)) {
        console.log(chalk.yellow(`Could not find Zen profiles directory at: ${profilesDir}`));
        console.log(chalk.white('Make sure you have installed and opened Zen Browser at least once.'));
        return;
    }

    const repoProfilePath = path.join(repoPath, 'profile');
    const items = fs.readdirSync(profilesDir, { withFileTypes: true });

    // --- Case 1: Already linked (junction/symlink exists and points to our profile) ---
    for (const item of items) {
        const fullPath = path.join(profilesDir, item.name);
        let stat;
        try { stat = fs.lstatSync(fullPath); } catch { continue; }

        if (stat.isSymbolicLink() && (item.name.endsWith('Default (release)') || item.name.endsWith('.default-release'))) {
            // Verify the link target
            try {
                const target = fs.readlinkSync(fullPath);
                if (path.resolve(target) === path.resolve(repoProfilePath)) {
                    console.log(chalk.green('✅ Your Zen profile is already linked to this repo!'));
                    return;
                } else {
                    // Linked, but to somewhere else (maybe old ZenSync path)
                    console.log(chalk.yellow(`Profile is linked but points to: ${target}`));
                    console.log(chalk.white(`Expected: ${repoProfilePath}`));
                    const { relink } = await inquirer.prompt([{
                        type: 'confirm',
                        name: 'relink',
                        message: 'Update the link to point to this repo?',
                        default: true
                    }]);
                    if (relink) {
                        // Remove old link (rmdir for junctions on Windows, unlink for symlinks)
                        if (platform === 'win32') {
                            fs.rmdirSync(fullPath);
                        } else {
                            fs.unlinkSync(fullPath);
                        }
                        createJunction(fullPath, repoProfilePath);
                        console.log(chalk.green('✅ Profile link updated!'));
                    }
                    return;
                }
            } catch (e) {
                // Broken link - will be handled by Case 3 below
            }
        }
    }

    // --- Case 2: Profile directory exists (not a link) -> backup + create junction ---
    const targetProfile = items.find(item => {
        const fullPath = path.join(profilesDir, item.name);
        try {
            const stat = fs.lstatSync(fullPath);
            return stat.isDirectory() && !stat.isSymbolicLink() &&
                (item.name.endsWith('Default (release)') || item.name.endsWith('.default-release'));
        } catch { return false; }
    });

    if (targetProfile) {
        const targetPath = path.join(profilesDir, targetProfile.name);

        console.log(chalk.white(`\nFound Zen Profile: ${chalk.cyan(targetProfile.name)}`));
        console.log(chalk.gray('This is a local profile. We can link it to your ZenSync repo.'));
        console.log(chalk.gray('This will BACKUP your local profile and REPLACE it with the synced one.'));

        const { confirmLink } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmLink',
            message: 'Backup this profile and link it to ZenSync?',
            default: true
        }]);

        if (!confirmLink) {
            console.log(chalk.yellow('Skipping profile linking.'));
            return;
        }

        try {
            const backupName = `backup_${targetProfile.name}_${Date.now()}`;
            const backupPath = path.join(profilesDir, backupName);

            console.log(chalk.gray(`Backing up to: ${backupName}...`));
            fs.renameSync(targetPath, backupPath);

            createJunction(targetPath, repoProfilePath);

            console.log(chalk.green('✅ Profile successfully linked!'));
            console.log(chalk.gray(`Original profile saved at: ${backupPath}`));
        } catch (error) {
            console.error(chalk.red('Failed to link profile:'), error.message);
            if (platform === 'win32') {
                console.log(chalk.yellow('You may need to run this as Administrator.'));
            }
        }
        return;
    }

    // --- Case 3: Profile folder is missing (broken junction was cleaned up, or fresh clone) ---
    const expectedName = getExpectedProfileName();
    if (expectedName) {
        const expectedPath = path.join(profilesDir, expectedName);
        if (!fs.existsSync(expectedPath)) {
            console.log(chalk.yellow(`\nZen expects a profile at: ${expectedName}`));
            console.log(chalk.white('But it is missing (this usually happens after a broken sync or re-clone).'));
            console.log(chalk.white(`We can create a junction to your repo profile at: ${repoProfilePath}`));

            const { createLink } = await inquirer.prompt([{
                type: 'confirm',
                name: 'createLink',
                message: 'Create the profile junction now?',
                default: true
            }]);

            if (createLink) {
                try {
                    createJunction(expectedPath, repoProfilePath);
                    console.log(chalk.green('✅ Profile junction created!'));
                    console.log(chalk.white('Zen Browser should now find your synced profile.'));
                } catch (error) {
                    console.error(chalk.red('Failed to create junction:'), error.message);
                    if (platform === 'win32') {
                        console.log(chalk.yellow('You may need to run this as Administrator.'));
                    }
                }
            }
            return;
        }
    }

    console.log(chalk.yellow('No suitable profile found to link.'));
    console.log(chalk.gray('Make sure you have opened Zen Browser at least once.'));
}

export async function setup(options = {}) {
    console.log(chalk.bold.blue('ZenSync Setup Wizard'));

    let repoPath = process.cwd();

    if (options.yes) {
        config.set('repoPath', repoPath);
        console.log(chalk.green('✅ Configuration saved (Non-interactive mode)!'));
        // We skip profile linking in non-interactive mode for safety
    } else {
        const answers = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'isCorrectDir',
                message: `Is this your ZenSync repository?\n  ${repoPath}`,
                default: true
            }
        ]);

        if (!answers.isCorrectDir) {
            console.log(chalk.red('Please navigate to your ZenSync directory and run setup again.'));
            process.exit(0);
        }

        config.set('repoPath', repoPath);
        console.log(chalk.green('✅ Configuration saved!'));
        
        // Run profile linking logic
        await linkProfile(repoPath);
    }

    console.log(chalk.white('\nYou can now run:'), chalk.cyan('zensync watch'));
}
