import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execa } from 'execa';
import config from './config.js';

// ─── Platform Helpers ─────────────────────────────────────────────────

function getProfilesDir() {
    const p = process.platform;
    if (p === 'win32') return path.join(os.homedir(), 'AppData', 'Roaming', 'Zen', 'Profiles');
    if (p === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'zen', 'Profiles');
    return null;
}

function getZenConfigDir() {
    const p = process.platform;
    if (p === 'win32') return path.join(os.homedir(), 'AppData', 'Roaming', 'Zen');
    if (p === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'zen');
    return null;
}

function getExpectedProfileName() {
    const zenDir = getZenConfigDir();
    if (!zenDir) return null;
    const iniPath = path.join(zenDir, 'profiles.ini');
    if (!fs.existsSync(iniPath)) return null;
    const lines = fs.readFileSync(iniPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const m = line.match(/^Default=Profiles\/(.+)$/);
        if (m) return m[1];
    }
    for (const line of lines) {
        const m = line.match(/^Path=Profiles\/(.+Default \(release\).*)$/);
        if (m) return m[1];
    }
    return null;
}

function createSymlink(targetPath, repoProfilePath) {
    fs.symlinkSync(repoProfilePath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function findLocalZenProfile() {
    const profilesDir = getProfilesDir();
    if (!profilesDir || !fs.existsSync(profilesDir)) return null;
    for (const item of fs.readdirSync(profilesDir, { withFileTypes: true })) {
        const fp = path.join(profilesDir, item.name);
        try {
            const s = fs.lstatSync(fp);
            if (s.isDirectory() && !s.isSymbolicLink() &&
                (item.name.endsWith('Default (release)') || item.name.endsWith('.default-release')))
                return fp;
        } catch { /* skip */ }
    }
    return null;
}

function isDirEmpty(p) {
    if (!fs.existsSync(p)) return true;
    return fs.readdirSync(p).filter(f => f !== '.DS_Store' && f !== 'Thumbs.db').length === 0;
}

function profileHasData(repoPath) {
    const p = path.join(repoPath, 'profile');
    return fs.existsSync(p) && fs.readdirSync(p).length > 0;
}

function shortPath(p) {
    const home = os.homedir();
    return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

// ─── UI Primitives ────────────────────────────────────────────────────

const DIM   = chalk.gray;
const CYAN  = chalk.cyan;
const OK    = chalk.green;
const WARN  = chalk.yellow;
const ERR   = chalk.red;
const BOLD  = chalk.bold.white;
const WIDTH = 52;

function ln(text = '') { console.log(text); }
function gap() { ln(''); }
function line() { ln(DIM('  ' + '─'.repeat(WIDTH))); }

function row(icon, text) {
    console.log(`  ${icon}  ${text}`);
}

function step(n, total, icon, label) {
    gap();
    line();
    ln(`  ${BOLD(`${n}/${total}`)}   ${icon}  ${BOLD(label)}`);
    line();
    gap();
}

function card(lines, borderColor = chalk.cyan) {
    const inner = WIDTH - 4;
    const top = borderColor('  ╭' + '─'.repeat(inner) + '╮');
    const bot = borderColor('  ╰' + '─'.repeat(inner) + '╯');
    ln(top);
    for (const l of lines) {
        const stripped = l.replace(/\x1b\[[0-9;]*m/g, '');
        const pad = inner - stripped.length;
        ln(borderColor('  │') + ' ' + l + ' '.repeat(Math.max(0, pad - 1)) + borderColor('│'));
    }
    ln(bot);
}

function spinner(text) {
    return ora({ text, color: 'cyan', spinner: 'dots', indent: 2 }).start();
}

// ─── Phase 1: Welcome & Directory ─────────────────────────────────────

async function chooseDirectory(options) {
    if (options.yes) return process.cwd();

    const defaultPath = path.join(os.homedir(), 'zensync-data');
    const cwd = process.cwd();

    // Detect if we're already in a valid profile repo
    const isRepo = fs.existsSync(path.join(cwd, '.git'));
    const hasProfile = fs.existsSync(path.join(cwd, 'profile'));
    const isSourceRepo = fs.existsSync(path.join(cwd, 'src', 'cli.js'));

    if (isRepo && hasProfile && !isSourceRepo) {
        card([
            `📂  Found existing repo here`,
            DIM(`    ${shortPath(cwd)}`),
        ]);
        gap();
        const { useCwd } = await inquirer.prompt([{
            type: 'confirm',
            name: 'useCwd',
            message: 'Use this directory?',
            default: true
        }]);
        if (useCwd) return cwd;
    }

    card([
        `${DIM('Recommended:')}  ${CYAN(shortPath(defaultPath))}`,
        ``,
        `${DIM('Press')} ${BOLD('Enter')} ${DIM('to accept, or type a different path.')}`,
    ]);
    gap();

    const { installDir } = await inquirer.prompt([{
        type: 'input',
        name: 'installDir',
        message: 'Location:',
        default: defaultPath,
        prefix: chalk.cyan('?'),
        transformer: (input) => CYAN(input)
    }]);

    let repoPath;
    if (installDir.startsWith('~/') || installDir === '~') {
        repoPath = path.join(os.homedir(), installDir.slice(1));
    } else {
        repoPath = path.resolve(installDir);
    }
    return repoPath;
}

// ─── Phase 2: Repository Setup ────────────────────────────────────────

async function setupRepository(repoPath) {
    const isGit = fs.existsSync(path.join(repoPath, '.git'));
    const hasProfile = fs.existsSync(path.join(repoPath, 'profile'));

    if (isGit && hasProfile) {
        row('✅', OK('Repository already configured.'));
        return true;
    }

    const empty = isDirEmpty(repoPath);

    if (!empty && !isGit) {
        card([
            WARN('⚠️  This directory is not empty'),
            DIM('   and doesn\'t look like a git repository.'),
        ], chalk.yellow);
        gap();
        const { proceed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'proceed',
            message: 'Initialize a new ZenSync repo here anyway?',
            default: false
        }]);
        if (!proceed) return false;
        return await createNewRepo(repoPath);
    }

    // Show two clear options with descriptions
    card([
        BOLD('Choose your setup path:'),
        ``,
        `${CYAN('Clone')}   ${DIM('Already using ZenSync on another device?')}`,
        `         ${DIM('Pull your profile from an existing Git repo.')}`,
        ``,
        `${CYAN('Create')}  ${DIM('First time here?')}`,
        `         ${DIM('We\'ll import your local Zen profile into a new repo.')}`,
    ]);
    gap();

    const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'Select:',
        prefix: chalk.cyan('?'),
        choices: [
            { name: `📥  Clone existing repo  ${DIM('— I have a Git URL')}`, value: 'clone' },
            { name: `✨  Create new repo      ${DIM('— First time setup')}`, value: 'create' }
        ]
    }]);

    if (action === 'clone') return await cloneExistingRepo(repoPath);
    return await createNewRepo(repoPath);
}

async function cloneExistingRepo(repoPath) {
    gap();
    card([
        `${DIM('Paste the URL of your ZenSync repo.')}`,
        ``,
        `${DIM('Example:')}  ${CYAN('https://github.com/you/zen-profile-data.git')}`,
        `${DIM('  or')}     ${CYAN('git@github.com:you/zen-profile-data.git')}`,
    ]);
    gap();

    const { repoUrl } = await inquirer.prompt([{
        type: 'input',
        name: 'repoUrl',
        message: 'Git URL:',
        prefix: chalk.cyan('?'),
        validate: input => {
            if (input.length < 5) return 'Please enter a valid Git URL';
            if (!input.includes('github.com') && !input.includes('gitlab.com') && !input.includes('git@') && !input.includes('https://'))
                return 'Hmm, that doesn\'t look like a Git URL. Double-check it!';
            return true;
        }
    }]);

    gap();
    const s = spinner('Cloning your profile repository...');

    try {
        const parentDir = path.dirname(repoPath);
        const dirName = path.basename(repoPath);

        if (isDirEmpty(repoPath)) {
            fs.rmSync(repoPath, { recursive: true, force: true });
        }

        await execa('git', ['clone', repoUrl, dirName], { cwd: parentDir });

        // Verify clone worked
        if (!fs.existsSync(repoPath) || !fs.existsSync(path.join(repoPath, '.git'))) {
            s.fail('Clone failed — directory is missing after clone.');
            row('💡', DIM('Try manually: ') + CYAN(`git clone ${repoUrl} ${repoPath}`));
            return false;
        }

        if (profileHasData(repoPath)) {
            const count = fs.readdirSync(path.join(repoPath, 'profile')).length;
            s.succeed(OK(`Cloned! Profile loaded with ${count} items.`));
        } else {
            s.succeed(OK('Cloned!'));
            row('⚠️', WARN('Heads up — the profile folder in this repo is empty.'));
            row('  ', DIM('You may need to push profile data from another device first.'));
        }
        return true;

    } catch (error) {
        s.fail('Clone failed.');
        gap();
        if (error.message.includes('not found') || error.message.includes('404')) {
            row('💡', 'Repository not found. Check the URL and try again.');
        } else if (error.message.includes('Authentication') || error.message.includes('403')) {
            row('💡', 'Access denied. Try: ' + CYAN('gh auth login'));
        } else {
            row('💡', DIM(error.shortMessage || error.message));
        }
        return false;
    }
}

async function createNewRepo(repoPath) {
    gap();
    const s = spinner('Initializing repository...');

    try {
        if (!fs.existsSync(repoPath)) fs.mkdirSync(repoPath, { recursive: true });

        await execa('git', ['init'], { cwd: repoPath });

        const profilePath = path.join(repoPath, 'profile');
        if (!fs.existsSync(profilePath)) fs.mkdirSync(profilePath);

        // .gitignore
        fs.writeFileSync(path.join(repoPath, '.gitignore'), [
            '# ZenSync — auto-generated',
            '',
            '# Caches & Temp',
            'cache/', 'caches/', 'startupCache/', 'thumbnails/',
            '*.tmp', '*.bak', '*.log',
            '',
            '# Lock Files',
            'lock', '.parentlock', 'parent.lock',
            '',
            '# Storage & Telemetry (too large for git)',
            'storage/', 'safebrowsing/', 'datareporting/',
            'saved-telemetry-pings/', 'crashes/', 'minidumps/', 'shader-cache/',
            '',
            '# SQLite Temp Files',
            '*.sqlite-wal', '*.sqlite-shm', '*.db-wal', '*.db-shm',
            '',
            '# Window State',
            'xulstore.json',
            '',
            '# Firefox Sync & Account (managed by Firefox, NOT by ZenSync)',
            'signedInUser.json', 'weave/', 'synced-tabs.db',
            '',
            '# Logins & Encryption Keys (sensitive + managed by Firefox Sync)',
            'key4.db', 'logins.json', 'logins.db', 'logins-backup.json', 'cert9.db',
            '',
            '# Extension Sync Storage (managed by Firefox Sync)',
            'storage-sync-v2.sqlite',
            '',
            '# OS',
            '.DS_Store', 'Thumbs.db', 'node_modules/',
            '',
            '# Session & History (handled by Firefox Sync)',
            'cookies.sqlite', 'places.sqlite', 'favicons.sqlite',
        ].join('\n') + '\n');

        // package.json
        fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
            name: "my-zen-profile",
            version: "1.0.0",
            description: "Zen Browser profile managed by ZenSync",
            scripts: { setup: "zensync setup", sync: "zensync watch" },
            dependencies: {}
        }, null, 2));

        s.succeed('Repository initialized.');

        // Import local profile
        const localProfile = findLocalZenProfile();
        if (localProfile) {
            gap();
            card([
                `🔍  ${BOLD('Found your Zen Browser profile!')}`,
                ``,
                `    ${CYAN(shortPath(localProfile))}`,
                ``,
                `${DIM('    We can copy your bookmarks, extensions, settings')}`,
                `${DIM('    and other data into the repo now.')}`,
            ]);
            gap();

            const { importProfile } = await inquirer.prompt([{
                type: 'confirm',
                name: 'importProfile',
                message: 'Import your browser data?',
                default: true,
                prefix: chalk.cyan('?'),
            }]);

            if (importProfile) {
                const s2 = spinner('Importing profile data...');
                try {
                    fs.cpSync(localProfile, profilePath, { recursive: true, force: true, dereference: true });
                    const count = fs.readdirSync(profilePath).length;
                    s2.succeed(OK(`Imported ${count} items from your profile.`));
                } catch (e) {
                    s2.fail('Failed to copy: ' + e.message);
                    row('💡', DIM('You can import manually later.'));
                }
            }
        } else {
            gap();
            row('ℹ️', DIM('No local Zen profile found to import.'));
            row('  ', DIM('Open Zen Browser at least once, then re-run setup.'));
        }

        // Initial commit
        gap();
        const s3 = spinner('Creating initial commit...');
        await execa('git', ['add', '.'], { cwd: repoPath });
        await execa('git', ['commit', '-m', 'Initial profile setup via ZenSync'], { cwd: repoPath });
        s3.succeed('Initial commit created.');

        // GitHub
        gap();
        card([
            `🐙  ${BOLD('Push to GitHub?')}`,
            ``,
            `${DIM('    A private repository keeps your profile safe')}`,
            `${DIM('    in the cloud and lets you sync between devices.')}`,
            ``,
            `${DIM('    Requires:')} ${CYAN('gh')} ${DIM('CLI (https://cli.github.com)')}`,
        ]);
        gap();

        const { setupGithub } = await inquirer.prompt([{
            type: 'confirm',
            name: 'setupGithub',
            message: 'Create a private GitHub repo?',
            default: true,
            prefix: chalk.cyan('?'),
        }]);

        if (setupGithub) {
            try {
                await execa('gh', ['--version']);

                const { repoName } = await inquirer.prompt([{
                    type: 'input',
                    name: 'repoName',
                    message: 'Repo name:',
                    default: 'zen-profile-data',
                    prefix: chalk.cyan('?'),
                }]);

                const s4 = spinner('Creating private repository on GitHub...');
                await execa('gh', ['repo', 'create', repoName, '--private', '--source=.', '--remote=origin', '--push'], { cwd: repoPath });
                const { stdout: user } = await execa('gh', ['api', 'user', '--jq', '.login']);
                s4.succeed(OK(`Created: `) + CYAN(`github.com/${user}/${repoName}`));

            } catch (e) {
                if (e.message.includes('ENOENT')) {
                    row('⚠️', WARN('GitHub CLI not found.'));
                    row('  ', DIM('Install from: ') + CYAN('https://cli.github.com'));
                } else {
                    row('⚠️', WARN('GitHub setup failed: ') + DIM(e.message));
                }
                row('💡', DIM('No worries — you can push manually later.'));
            }
        }

        return true;

    } catch (error) {
        row('❌', ERR('Failed: ') + error.message);
        return false;
    }
}

// ─── Phase 3: Profile Linking ─────────────────────────────────────────

async function linkProfile(repoPath) {
    const platform = process.platform;
    const profilesDir = getProfilesDir();
    const repoProfilePath = path.join(repoPath, 'profile');

    if (!profilesDir) {
        row('⚠️', WARN('Profile linking is not supported on this platform yet.'));
        return;
    }

    if (!fs.existsSync(profilesDir)) {
        card([
            `${WARN('⚠️  Zen Browser not found')}`,
            ``,
            `${DIM('    We couldn\'t find the Profiles directory.')}`,
            `${DIM('    Open Zen Browser at least once, then re-run setup.')}`,
        ], chalk.yellow);
        return;
    }

    // Safety: warn if repo profile is empty
    const repoProfileEmpty = !fs.existsSync(repoProfilePath) || fs.readdirSync(repoProfilePath).length === 0;

    if (repoProfileEmpty) {
        gap();
        card([
            `${ERR('🚨  Profile folder is EMPTY')}`,
            ``,
            `${DIM('    Linking now would replace your browser data')}`,
            `${DIM('    with an empty folder — that\'s probably not')}`,
            `${DIM('    what you want.')}`,
            ``,
            `${DIM('    This usually means the clone didn\'t include')}`,
            `${DIM('    any profile data yet.')}`,
        ], chalk.red);
        gap();

        const { forceLink } = await inquirer.prompt([{
            type: 'confirm',
            name: 'forceLink',
            message: 'Link the empty profile anyway?',
            default: false,
            prefix: chalk.red('!')
        }]);

        if (!forceLink) {
            row('🛡️', OK('Good call — your browser data is safe.'));
            row('  ', DIM('Import or push profile data first, then re-run setup.'));
            return;
        }
    }

    const items = fs.readdirSync(profilesDir, { withFileTypes: true });

    // ── Case 1: Symlink already exists ──
    for (const item of items) {
        const fullPath = path.join(profilesDir, item.name);
        let stat;
        try { stat = fs.lstatSync(fullPath); } catch { continue; }

        if (stat.isSymbolicLink() && (item.name.endsWith('Default (release)') || item.name.endsWith('.default-release'))) {
            try {
                const target = fs.readlinkSync(fullPath);
                if (path.resolve(target) === path.resolve(repoProfilePath)) {
                    row('✅', OK('Already linked to this repo!'));
                    row('  ', DIM(`${shortPath(fullPath)} → ${shortPath(repoProfilePath)}`));
                    return;
                } else {
                    card([
                        `${WARN('🔗  Profile is linked elsewhere')}`,
                        ``,
                        `${DIM('    Current:')}  ${CYAN(shortPath(target))}`,
                        `${DIM('    New:')}      ${CYAN(shortPath(repoProfilePath))}`,
                    ], chalk.yellow);
                    gap();

                    const { relink } = await inquirer.prompt([{
                        type: 'confirm',
                        name: 'relink',
                        message: 'Update the link to this repo?',
                        default: true,
                        prefix: chalk.cyan('?'),
                    }]);

                    if (relink) {
                        if (platform === 'win32') fs.rmdirSync(fullPath);
                        else fs.unlinkSync(fullPath);
                        createSymlink(fullPath, repoProfilePath);
                        row('✅', OK('Link updated!'));
                    }
                    return;
                }
            } catch { /* broken link — Case 3 */ }
        }
    }

    // ── Case 2: Real profile directory → backup & link ──
    const targetProfile = items.find(item => {
        try {
            const s = fs.lstatSync(path.join(profilesDir, item.name));
            return s.isDirectory() && !s.isSymbolicLink() &&
                (item.name.endsWith('Default (release)') || item.name.endsWith('.default-release'));
        } catch { return false; }
    });

    if (targetProfile) {
        const targetPath = path.join(profilesDir, targetProfile.name);

        card([
            `🔍  ${BOLD('Found your Zen profile')}`,
            ``,
            `    ${CYAN(targetProfile.name)}`,
            ``,
            `${DIM('    Here\'s what happens next:')}`,
            ``,
            `    ${OK('1.')} ${DIM('Your current profile is backed up  (nothing lost!)')}`,
            `    ${OK('2.')} ${DIM('A symlink connects Zen to your repo')}`,
            `    ${OK('3.')} ${DIM('Zen Browser uses the synced profile')}`,
        ]);
        gap();

        const { confirmLink } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmLink',
            message: 'Backup & link now?',
            default: true,
            prefix: chalk.cyan('?'),
        }]);

        if (!confirmLink) {
            row('⏭️', DIM('Skipped. You can link later with: ') + CYAN('zensync setup'));
            return;
        }

        const s = spinner('Backing up and linking...');
        try {
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const backupName = `backup_${targetProfile.name}_${ts}`;
            const backupPath = path.join(profilesDir, backupName);

            fs.renameSync(targetPath, backupPath);
            createSymlink(targetPath, repoProfilePath);

            s.succeed(OK('Profile linked!'));
            row('🛡️', DIM(`Backup: ${shortPath(backupPath)}`));
        } catch (error) {
            s.fail('Link failed: ' + error.message);
            if (platform === 'win32') row('💡', WARN('Try running as Administrator.'));
        }
        return;
    }

    // ── Case 3: Missing profile → create link ──
    const expectedName = getExpectedProfileName();
    if (expectedName) {
        const expectedPath = path.join(profilesDir, expectedName);
        if (!fs.existsSync(expectedPath)) {
            card([
                `${WARN('⚠️  Expected profile is missing')}`,
                ``,
                `${DIM('    Zen Browser expects:')}  ${CYAN(expectedName)}`,
                `${DIM('    But it\'s not there — probably a broken link.')}`,
                ``,
                `${DIM('    We can create a fresh link to your repo.')}`,
            ], chalk.yellow);
            gap();

            const { createLink } = await inquirer.prompt([{
                type: 'confirm',
                name: 'createLink',
                message: 'Create the link?',
                default: true,
                prefix: chalk.cyan('?'),
            }]);

            if (createLink) {
                try {
                    createSymlink(expectedPath, repoProfilePath);
                    row('✅', OK('Link created!'));
                    row('  ', DIM(`${expectedName} → ${shortPath(repoProfilePath)}`));
                } catch (error) {
                    row('❌', ERR('Failed: ') + error.message);
                    if (process.platform === 'win32') row('💡', WARN('Try running as Administrator.'));
                }
            }
            return;
        }
    }

    row('⚠️', WARN('No Zen profile found to link.'));
    row('  ', DIM('Open Zen Browser once to create a profile, then re-run setup.'));
}

// ─── Main ─────────────────────────────────────────────────────────────

export async function setup(options = {}) {
    const T = 3; // total steps

    // ── Welcome ──
    gap();
    card([
        ``,
        `       ${chalk.bold('🧘  ZenSync  Setup  Wizard  🧘')}`,
        ``,
        `   ${DIM('Sync your Zen Browser profile across devices.')}`,
        `   ${DIM('It only takes a minute.')} ✨`,
        ``,
    ]);

    // ── Step 1: Directory ──
    step(1, T, '📁', 'Storage Location');

    const repoPath = await chooseDirectory(options);

    if (!fs.existsSync(repoPath)) {
        const s = spinner(`Creating ${shortPath(repoPath)}...`);
        fs.mkdirSync(repoPath, { recursive: true });
        s.succeed(`Directory ready: ${CYAN(shortPath(repoPath))}`);
    } else {
        row('📂', `Using: ${CYAN(shortPath(repoPath))}`);
    }

    config.set('repoPath', repoPath);
    row('💾', OK('Saved!'));

    // ── Step 2: Repository ──
    step(2, T, '📦', 'Profile Repository');

    const ready = await setupRepository(repoPath);
    if (!ready) {
        gap();
        card([
            `${ERR('❌  Setup could not be completed.')}`,
            ``,
            `${DIM('    Fix the issue above and run:')}`,
            `    ${CYAN('zensync setup')}`,
        ], chalk.red);
        gap();
        return;
    }

    // ── Step 3: Link ──
    step(3, T, '🔗', 'Browser Link');

    process.chdir(repoPath);
    await linkProfile(repoPath);

    // ── Summary ──
    gap();
    const ok = profileHasData(repoPath);
    card(ok ? [
        ``,
        `   🎉  ${chalk.bold.green('All done! ZenSync is ready.')}`,
        ``,
        `   ${DIM('Your profile is synced and linked.')}`,
        `   ${DIM('Close Zen Browser to trigger a sync, or run watch.')}`,
        ``,
    ] : [
        ``,
        `   ⚡  ${chalk.bold.yellow('Almost there!')}`,
        ``,
        `   ${DIM('Setup complete, but your profile folder is empty.')}`,
        `   ${DIM('Push data from another device, or re-run setup.')}`,
        ``,
    ], ok ? chalk.green : chalk.yellow);

    gap();
    row('📂', `Data:   ${CYAN(shortPath(repoPath))}`);
    row('🚀', `Sync:   ${CYAN('zensync watch')}`);
    row('📊', `Status: ${CYAN('zensync status')}`);
    gap();
    line();
    gap();
}
