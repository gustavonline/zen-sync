import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execa } from 'execa';
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

/**
 * Phase 3: Link the repo profile to the Zen Browser profile folder
 */
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
    
    // SAFETY CHECK: Ensure repo profile is not empty before linking
    if (!fs.existsSync(repoProfilePath) || fs.readdirSync(repoProfilePath).length === 0) {
        console.log(chalk.red('\n⚠️  Critical Safety Warning ⚠️'));
        console.log(chalk.white('The repository profile folder is EMPTY.'));
        console.log(chalk.white('Linking this would wipe your browser profile if not backed up correctly.'));
        console.log(chalk.white('This typically happens if you just initialized a repo but didn\'t import your data.'));
        
        const { forceLink } = await inquirer.prompt([{
            type: 'confirm',
            name: 'forceLink',
            message: 'Do you really want to link an EMPTY profile? (Not recommended)',
            default: false
        }]);
        
        if (!forceLink) {
            console.log(chalk.yellow('Aborting setup to protect your data.'));
            return;
        }
    }

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

/**
 * Helper: Find local Zen profile to import
 */
function findLocalZenProfile() {
    const profilesDir = getProfilesDir();
    if (!profilesDir || !fs.existsSync(profilesDir)) return null;

    const items = fs.readdirSync(profilesDir, { withFileTypes: true });
    // Look for default release profile
    const targetProfile = items.find(item => {
        return item.isDirectory() && !item.isSymbolicLink() &&
            (item.name.endsWith('Default (release)') || item.name.endsWith('.default-release'));
    });
    
    if (targetProfile) {
        return path.join(profilesDir, targetProfile.name);
    }
    return null;
}

/**
 * Phase 2: Handle initialization (New Repo, Clone, or Existing)
 */
async function handleInitialization() {
    const cwd = process.cwd();
    const isGit = fs.existsSync(path.join(cwd, '.git'));
    const hasProfile = fs.existsSync(path.join(cwd, 'profile'));

    // If it looks like a valid repo, assume we are good to go
    if (isGit && hasProfile) {
        return true; 
    }

    console.log(chalk.bold('Welcome to ZenSync! 🚀'));
    console.log(chalk.white('It looks like this directory is not set up yet.'));
    console.log(chalk.gray(`Current directory: ${cwd}\n`));

    const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
            { name: '📥  Clone an existing ZenSync repository (New Machine)', value: 'clone' },
            { name: '✨  Create a new ZenSync repository here (First Time Setup)', value: 'create' },
            { name: '🔧  Use current directory as-is (Advanced)', value: 'current' }
        ]
    }]);

    if (action === 'clone') {
        const { repoUrl } = await inquirer.prompt([{
            type: 'input',
            name: 'repoUrl',
            message: 'Enter the Git URL to clone (e.g. https://github.com/user/zen-profile.git):',
            validate: input => input.length > 5 ? true : 'Please enter a valid URL'
        }]);

        console.log(chalk.blue(`\nCloning ${repoUrl}...`));
        try {
            await execa('git', ['clone', repoUrl, '.']);
            console.log(chalk.green('✅ Repository cloned successfully!'));
            return true;
        } catch (error) {
            console.error(chalk.red('Failed to clone repository:'), error.message);
            console.log(chalk.yellow('Make sure the directory is empty or the URL is correct.'));
            process.exit(1);
        }
    } else if (action === 'create') {
        console.log(chalk.blue('\nInitializing new ZenSync repository...'));
        
        try {
            // 1. Git Init
            await execa('git', ['init']);
            
            // 2. Create structure
            const profilePath = path.join(cwd, 'profile');
            if (!fs.existsSync(profilePath)) fs.mkdirSync(profilePath);

            // 3. Create .gitignore
            const gitignoreContent = `# Ignore Caches and Temporary Files
cache/
caches/
startupCache/
thumbnails/
*.tmp
*.bak
*.log

# Ignore Lock Files
lock
.parentlock
parent.lock

# Ignore Storage/Site Data (Too large/variable for Git)
storage/
safebrowsing/
datareporting/
saved-telemetry-pings/
crashes/
minidumps/
shader-cache/

# Ignore Sqlite Temporary Files
*.sqlite-wal
*.sqlite-shm

# Ignore Window State
xulstore.json

# Sync Logs
weave/

# OS Specific
.DS_Store
Thumbs.db
node_modules/

# Ignore Session and History Files
cookies.sqlite
places.sqlite
favicons.sqlite
`;
            fs.writeFileSync(path.join(cwd, '.gitignore'), gitignoreContent);
            
            // 4. Create package.json
            const packageJson = {
                name: "my-zen-profile",
                version: "1.0.0",
                description: "My Zen Browser Profile managed by ZenSync",
                scripts: {
                    "setup": "zensync setup",
                    "sync": "zensync watch",
                    "backup": "zensync backup",
                    "restore": "zensync restore"
                },
                dependencies: {}
            };
            fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify(packageJson, null, 2));

            // 5. Import Profile Data
            const localProfile = findLocalZenProfile();
            if (localProfile) {
                console.log(chalk.white(`Found local Zen profile at: ${localProfile}`));
                const { importProfile } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'importProfile',
                    message: 'Do you want to import your current browser data into this repo?',
                    default: true
                }]);

                if (importProfile) {
                    console.log(chalk.blue('Importing profile data... (This might take a moment)'));
                    // Use cp -R logic (execa might be safer for cross-platform recursive copy if 'cp' isn't available, 
                    // but we can use fs.cpSync in Node 16.7+)
                     try {
                        fs.cpSync(localProfile, profilePath, { recursive: true, force: true, dereference: true });
                        console.log(chalk.green('✅ Profile data imported!'));
                     } catch (err) {
                        console.error(chalk.red('Failed to copy profile data:'), err.message);
                     }
                }
            } else {
                console.log(chalk.yellow('No local Zen profile found to import. You will start with an empty profile.'));
            }
            
            // 6. Initial Commit
            await execa('git', ['add', '.']);
            await execa('git', ['commit', '-m', 'Initial profile setup via ZenSync']);
            console.log(chalk.green('✅ Local repository initialized!'));

            // 7. GitHub Setup
            const { setupGithub } = await inquirer.prompt([{
                type: 'confirm',
                name: 'setupGithub',
                message: 'Do you want to create a private GitHub repository for this now?',
                default: true
            }]);

            if (setupGithub) {
                try {
                    await execa('gh', ['--version']); // Check if gh is installed
                    console.log(chalk.blue('Creating private repository on GitHub...'));
                    const repoName = 'zen-profile-data-' + Date.now().toString().slice(-4);
                    
                    const { confirmName } = await inquirer.prompt([{
                        type: 'input',
                        name: 'confirmName',
                        message: 'Repository name:',
                        default: 'zen-profile-data'
                    }]);

                    // Create repo
                    await execa('gh', ['repo', 'create', confirmName, '--private', '--source=.', '--remote=origin', '--push']);
                    console.log(chalk.green(`✅ Repository created: https://github.com/${(await execa('gh', ['api', 'user', '--jq', '.login'])).stdout}/${confirmName}`));
                } catch (e) {
                    console.error(chalk.red('GitHub CLI (gh) not found or failed.'));
                    console.log(chalk.white('You can manually push this repo later using standard git commands.'));
                }
            }

            return true;

        } catch (error) {
            console.error(chalk.red('Failed to initialize repository:'), error.message);
            return false;
        }
    }

    return true; // Proceed for 'current'
}

export async function setup(options = {}) {
    console.log(chalk.bold.blue('ZenSync Setup Wizard'));

    let repoPath = process.cwd();

    if (options.yes) {
        config.set('repoPath', repoPath);
        console.log(chalk.green('✅ Configuration saved (Non-interactive mode)!'));
    } else {
        // Run Phase 2: Initialization checks
        const ready = await handleInitialization();
        if (!ready) {
            console.log(chalk.red('Setup aborted.'));
            return;
        }

        config.set('repoPath', repoPath);
        console.log(chalk.green('✅ Configuration saved!'));
        
        // Run Phase 3: Profile Linking
        await linkProfile(repoPath);
    }

    console.log(chalk.white('\nYou can now run:'), chalk.cyan('zensync watch'));
}
