import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import config from './config.js';

async function linkProfile(repoPath) {
    const platform = process.platform;
    let profilesDir;

    if (platform === 'win32') {
        profilesDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Zen', 'Profiles');
    } else if (platform === 'darwin') {
        profilesDir = path.join(os.homedir(), 'Library', 'Application Support', 'zen', 'Profiles');
    } else {
        console.log(chalk.yellow('Skipping profile linking: Unsupported platform.'));
        return;
    }

    if (!fs.existsSync(profilesDir)) {
        console.log(chalk.yellow(`Could not find Zen profiles directory at: ${profilesDir}`));
        console.log(chalk.white('Make sure you have installed and opened Zen Browser at least once.'));
        return;
    }

    // Find the default profile
    const items = fs.readdirSync(profilesDir, { withFileTypes: true });
    
    // Look for a directory that ends with 'Default (release)' and is NOT a symbolic link/junction already
    // On Mac it is often just "*.Default (release)" or similar.
    // We look for the one that Zen created.
    const targetProfile = items.find(item => 
        item.isDirectory() && 
        (item.name.endsWith('Default (release)') || item.name.endsWith('.default-release')) && 
        !fs.lstatSync(path.join(profilesDir, item.name)).isSymbolicLink()
    );

    // Check if we are already linked (for messaging purposes)
    const existingLink = items.find(item => 
        item.isSymbolicLink() && 
        (item.name.endsWith('Default (release)') || item.name.endsWith('.default-release'))
    );

    if (existingLink) {
        // Verify if it points to our repo
        try {
            // We just check if it's a link, we assume it's ours if it exists as a link
            console.log(chalk.green('✅ Your Zen profile is already linked!'));
            return;
        } catch (e) {
            // Ignore error
        }
    }

    if (!targetProfile) {
        console.log(chalk.yellow('No suitable default profile found to link (or it is already linked).'));
        return;
    }

    const targetPath = path.join(profilesDir, targetProfile.name);
    const repoProfilePath = path.join(repoPath, 'profile');

    console.log(chalk.white(`\nFound Zen Profile: ${chalk.cyan(targetProfile.name)}`));
    console.log(chalk.gray('This appears to be a local profile. We can link it to your ZenSync repo.'));
    console.log(chalk.gray('This will BACKUP your local profile and REPLACE it with the one from this repo.'));
    
    const { confirmLink } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirmLink',
            message: 'Do you want to backup this profile and link it to ZenSync?',
            default: true
        }
    ]);

    if (!confirmLink) {
        console.log(chalk.yellow('Skipping profile linking.'));
        return;
    }

    try {
        const backupName = `backup_${targetProfile.name}_${Date.now()}`;
        const backupPath = path.join(profilesDir, backupName);

        console.log(chalk.gray(`Backing up local profile to: ${backupName}...`));
        fs.renameSync(targetPath, backupPath);

        console.log(chalk.gray('Creating link to repo profile...'));
        // 'junction' is required for directories on Windows to act like native folders for apps
        // On macOS 'dir' creates a standard symlink
        const type = platform === 'win32' ? 'junction' : 'dir'; 
        fs.symlinkSync(repoProfilePath, targetPath, type);

        console.log(chalk.green('✅ Profile successfully linked!'));
        console.log(chalk.gray(`Your original local profile is safe at: ${backupPath}`));
        console.log(chalk.white('When you open Zen Browser, it will now use your synced profile.'));

    } catch (error) {
        console.error(chalk.red('Failed to link profile:'), error.message);
        if (platform === 'win32') {
            console.log(chalk.yellow('You may need to run this command as Administrator (or in an Admin terminal).'));
        }
    }
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
