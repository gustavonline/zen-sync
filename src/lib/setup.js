import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execa } from 'execa';
import config from './config.js';

// ─── Platform Helpers ─────────────────────────────────────────────────

function getZenConfigDirCandidates() {
    const home = os.homedir();
    const p = process.platform;

    if (p === 'win32') return [path.join(home, 'AppData', 'Roaming', 'Zen')];
    if (p === 'darwin') return [path.join(home, 'Library', 'Application Support', 'zen')];
    if (p === 'linux') return [
        path.join(home, '.zen'),
        path.join(home, '.var', 'app', 'app.zen_browser.zen', 'zen'),
        path.join(home, '.var', 'app', 'io.github.zen_browser.zen', '.zen'),
        path.join(home, '.var', 'app', 'io.github.zen_browser.zen', 'zen'),
    ];

    return [];
}

function getZenConfigDir() {
    const candidates = getZenConfigDirCandidates();
    return candidates.find(dir => fs.existsSync(path.join(dir, 'profiles.ini'))) ||
        candidates.find(dir => fs.existsSync(dir)) ||
        candidates[0] ||
        null;
}

function getProfilesDir() {
    const zenDir = getZenConfigDir();
    if (!zenDir) return null;

    const profilesDir = path.join(zenDir, 'Profiles');
    return fs.existsSync(profilesDir) ? profilesDir : zenDir;
}

function parseIniSections(text) {
    const sections = [];
    let current = { name: null, lines: [] };
    sections.push(current);

    for (const line of text.split(/\r?\n/)) {
        const header = line.match(/^\[([^\]]+)\]$/);
        if (header) {
            current = { name: header[1], lines: [] };
            sections.push(current);
        } else {
            current.lines.push(line);
        }
    }

    return sections;
}

function serializeIniSections(sections) {
    return sections.map(section => {
        const body = section.lines.join('\n').replace(/\n+$/g, '');
        if (!section.name) return body;
        return `[${section.name}]${body ? `\n${body}` : ''}`;
    }).filter(Boolean).join('\n\n') + '\n';
}

function getIniValue(section, key) {
    const prefix = `${key}=`;
    const line = section.lines.find(l => l.startsWith(prefix));
    return line ? line.slice(prefix.length) : null;
}

function setIniValue(section, key, value) {
    const prefix = `${key}=`;
    const idx = section.lines.findIndex(l => l.startsWith(prefix));
    if (idx >= 0) section.lines[idx] = `${key}=${value}`;
    else section.lines.push(`${key}=${value}`);
}

function deleteIniValue(section, key) {
    const prefix = `${key}=`;
    section.lines = section.lines.filter(l => !l.startsWith(prefix));
}

function resolveProfilePath(zenDir, section) {
    const profilePath = getIniValue(section, 'Path');
    if (!profilePath) return null;

    if (getIniValue(section, 'IsRelative') === '0' || path.isAbsolute(profilePath)) {
        return path.resolve(profilePath);
    }

    return path.resolve(zenDir, profilePath.replace(/\//g, path.sep));
}

function findLocalZenProfile() {
    const zenDir = getZenConfigDir();
    const iniPath = zenDir ? path.join(zenDir, 'profiles.ini') : null;

    if (iniPath && fs.existsSync(iniPath)) {
        const sections = parseIniSections(fs.readFileSync(iniPath, 'utf8'));
        const profiles = sections.filter(section => section.name?.startsWith('Profile'));
        const preferred = [
            ...profiles.filter(section => getIniValue(section, 'Default') === '1'),
            ...profiles.filter(section => (getIniValue(section, 'Name') || '').includes('Default (release)')),
            ...profiles,
        ];

        for (const section of preferred) {
            const fp = resolveProfilePath(zenDir, section);
            if (!fp || !fs.existsSync(fp)) continue;

            try {
                const s = fs.lstatSync(fp);
                if (s.isDirectory() && !s.isSymbolicLink()) return fp;
            } catch { /* skip */ }
        }
    }

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

        try {
            await execa('git', ['init', '-b', 'main'], { cwd: repoPath });
        } catch {
            // Fallback for older Git versions that don't support `git init -b`
            await execa('git', ['init'], { cwd: repoPath });
            await execa('git', ['branch', '-M', 'main'], { cwd: repoPath });
        }

        const profilePath = path.join(repoPath, 'profile');
        if (!fs.existsSync(profilePath)) fs.mkdirSync(profilePath);

        // .gitignore
        fs.writeFileSync(path.join(repoPath, '.gitignore'), [
            '# ZenSync — auto-generated',
            '',
            '# Caches & Temp',
            'cache/', 'cache2/', 'caches/', 'startupCache/', 'thumbnails/',
            '*.tmp', '*.bak', '*.log',
            '.zensync-recovery/', 'jumpListCache/',
            '',
            '# Lock Files',
            'lock', '.parentlock', 'parent.lock',
            '',
            '# Sensitive / bulky local site data (never sync)',
            'storage/', 'safebrowsing/', 'datareporting/',
            'saved-telemetry-pings/', 'crashes/', 'minidumps/', 'shader-cache/',
            'cookies.sqlite', 'places.sqlite', 'favicons.sqlite', 'formhistory.sqlite',
            'storage.sqlite', 'webappsstore.sqlite', 'tabnotes.sqlite',
            'autofill-profiles.json', 'activity-stream.*.json', 'targeting.snapshot.json',
            '',
            '# Media plugins / DRM state (downloaded or machine-specific)',
            'gmp/', 'gmp-gmpopenh264/', 'gmp-widevinecdm/',
            '',
            '# SQLite Temp Files',
            '*.sqlite-wal', '*.sqlite-shm', '*.sqlite-journal', '*.db-wal', '*.db-shm',
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
            '# ZenSync intentionally DOES sync closed-browser session files so tabs restore across devices:',
            '# sessionstore.jsonlz4, sessionCheckpoints.json, sessionstore-backups/, zen-sessions*.jsonlz4',
            '',
            '# Session restore diagnostics',
            'sessionstore-logs/',
            '',
            '# Machine / network runtime state (not useful to sync)',
            'AlternateServices.bin',
            'SiteSecurityServiceState.bin',
            'compatibility.ini',
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

function backupConfigFile(filePath) {
    if (!fs.existsSync(filePath)) return null;

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = `${filePath}.zensync-backup-${ts}`;
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
}

function upsertDefaultProfileInIni(iniPath, repoProfilePath) {
    const sections = fs.existsSync(iniPath)
        ? parseIniSections(fs.readFileSync(iniPath, 'utf8'))
        : [{ name: null, lines: [] }];

    let profileSections = sections.filter(section => section.name?.startsWith('Profile'));
    let defaultProfile = profileSections.find(section => getIniValue(section, 'Default') === '1') ||
        profileSections.find(section => (getIniValue(section, 'Name') || '').includes('Default (release)')) ||
        profileSections.find(section => (getIniValue(section, 'Path') || '').includes('Default (release)')) ||
        profileSections[0];

    if (!defaultProfile) {
        const profileNumbers = profileSections
            .map(section => Number.parseInt(section.name.replace('Profile', ''), 10))
            .filter(Number.isFinite);
        const next = profileNumbers.length ? Math.max(...profileNumbers) + 1 : 0;
        defaultProfile = { name: `Profile${next}`, lines: [] };
        sections.push(defaultProfile);
        profileSections = sections.filter(section => section.name?.startsWith('Profile'));
    }

    for (const section of profileSections) {
        if (section !== defaultProfile) deleteIniValue(section, 'Default');
    }

    setIniValue(defaultProfile, 'Name', getIniValue(defaultProfile, 'Name') || 'Default (release)');
    setIniValue(defaultProfile, 'IsRelative', '0');
    setIniValue(defaultProfile, 'Path', repoProfilePath);
    setIniValue(defaultProfile, 'Default', '1');

    for (const section of sections.filter(section => section.name?.startsWith('Install'))) {
        setIniValue(section, 'Default', repoProfilePath);
        setIniValue(section, 'Locked', '1');
    }

    const general = sections.find(section => section.name === 'General');
    if (general) {
        setIniValue(general, 'StartWithLastProfile', '1');
        setIniValue(general, 'Version', getIniValue(general, 'Version') || '2');
    }

    fs.writeFileSync(iniPath, serializeIniSections(sections));
}

function upsertDefaultProfileInInstallsIni(iniPath, repoProfilePath) {
    if (!fs.existsSync(iniPath)) return false;

    const sections = parseIniSections(fs.readFileSync(iniPath, 'utf8'));
    for (const section of sections.filter(section => section.name)) {
        setIniValue(section, 'Default', repoProfilePath);
        setIniValue(section, 'Locked', '1');
    }

    fs.writeFileSync(iniPath, serializeIniSections(sections));
    return true;
}

async function linkProfile(repoPath) {
    const zenDir = getZenConfigDir();
    const repoProfilePath = path.resolve(repoPath, 'profile');

    if (!zenDir || !fs.existsSync(zenDir)) {
        card([
            `${WARN('⚠️  Zen Browser not found')}`,
            ``,
            `${DIM('    Open Zen Browser once, then re-run setup.')}`,
            `${DIM('    ZenSync needs profiles.ini to point Zen at the repo.')}`,
        ], chalk.yellow);
        return;
    }

    const repoProfileEmpty = !fs.existsSync(repoProfilePath) || fs.readdirSync(repoProfilePath).length === 0;
    if (repoProfileEmpty) {
        gap();
        card([
            `${ERR('🚨  Profile folder is EMPTY')}`,
            ``,
            `${DIM('    Linking now would make Zen open an empty profile.')}`,
            `${DIM('    Pull profile data first, or import local data.')}`,
        ], chalk.red);
        gap();

        const { forceLink } = await inquirer.prompt([{
            type: 'confirm',
            name: 'forceLink',
            message: 'Point Zen at the empty profile anyway?',
            default: false,
            prefix: chalk.red('!')
        }]);

        if (!forceLink) {
            row('🛡️', OK('Skipped — your browser data is safe.'));
            return;
        }
    }

    const profilesIni = path.join(zenDir, 'profiles.ini');
    const installsIni = path.join(zenDir, 'installs.ini');

    if (!fs.existsSync(profilesIni)) {
        card([
            `${WARN('⚠️  profiles.ini not found')}`,
            ``,
            `${DIM('    Open Zen Browser once, close it, then re-run setup.')}`,
        ], chalk.yellow);
        return;
    }

    const s = spinner('Pointing Zen Browser at the synced profile...');
    try {
        const profileBackup = backupConfigFile(profilesIni);
        const installsBackup = backupConfigFile(installsIni);

        upsertDefaultProfileInIni(profilesIni, repoProfilePath);
        upsertDefaultProfileInInstallsIni(installsIni, repoProfilePath);

        s.succeed(OK('Zen now uses the synced profile directly.'));
        row('📂', DIM(`Profile: ${shortPath(repoProfilePath)}`));
        if (profileBackup || installsBackup) {
            row('🛡️', DIM('Backed up Zen profile config before editing.'));
        }
    } catch (error) {
        s.fail('Failed to update Zen profile config: ' + error.message);
    }
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
