import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execa } from 'execa';
import psList from 'ps-list';
import config from './config.js';
import { enableStartup } from './startup.js';
import { startDaemon, stopDaemon, getDaemonStatus } from './daemon.js';

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

function stripAnsi(text = '') {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function makeTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function makeBackupPath(targetPath) {
    return `${targetPath}.backup-${makeTimestamp()}`;
}

function movePathToBackup(targetPath, backupPath) {
    fs.renameSync(targetPath, backupPath);
    return backupPath;
}

async function getOriginUrl(repoPath) {
    try {
        const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], { cwd: repoPath });
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

async function getGitIdentity() {
    try {
        const [{ stdout: name }, { stdout: email }] = await Promise.all([
            execa('git', ['config', '--global', 'user.name']),
            execa('git', ['config', '--global', 'user.email'])
        ]);
        return {
            configured: Boolean(name.trim() && email.trim()),
            name: name.trim(),
            email: email.trim()
        };
    } catch {
        return { configured: false, name: '', email: '' };
    }
}

async function detectGitStatus() {
    try {
        const { stdout } = await execa('git', ['--version']);
        return { installed: true, version: stdout.trim() };
    } catch (error) {
        if (error.code === 'ENOENT') return { installed: false, version: null };
        return { installed: false, version: null };
    }
}

async function detectGithubCliStatus() {
    try {
        const { stdout: version } = await execa('gh', ['--version']);
        try {
            await execa('gh', ['auth', 'status']);
            let user = '';
            try {
                const { stdout } = await execa('gh', ['api', 'user', '--jq', '.login']);
                user = stdout.trim();
            } catch {
                user = '';
            }
            return {
                installed: true,
                authenticated: true,
                version: version.split(/\r?\n/)[0]?.trim() || 'gh',
                user,
                reason: ''
            };
        } catch (error) {
            const details = [error.stderr, error.stdout, error.shortMessage, error.message]
                .filter(Boolean)
                .join(' ')
                .trim();
            return {
                installed: true,
                authenticated: false,
                version: version.split(/\r?\n/)[0]?.trim() || 'gh',
                user: '',
                reason: details || 'GitHub CLI is installed, but you are not logged in.'
            };
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            return {
                installed: false,
                authenticated: false,
                version: null,
                user: '',
                reason: 'GitHub CLI (gh) is not installed.'
            };
        }
        return {
            installed: false,
            authenticated: false,
            version: null,
            user: '',
            reason: error.message || 'Could not check GitHub CLI status.'
        };
    }
}

const LOCAL_ONLY_PROFILE_PATHS = [
    'profile/key4.db',
    'profile/cert9.db',
    'profile/logins.json',
    'profile/logins.db',
    'profile/logins-backup.json',
    'profile/cookies.sqlite',
    'profile/places.sqlite',
    'profile/favicons.sqlite',
    'profile/formhistory.sqlite',
    'profile/storage',
    'profile/storage.sqlite',
    'profile/webappsstore.sqlite',
    'profile/tabnotes.sqlite',
    'profile/autofill-profiles.json',
];

function copyPathIfExists(source, destination) {
    if (!fs.existsSync(source)) return false;

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const stat = fs.lstatSync(source);
    if (stat.isDirectory()) {
        fs.cpSync(source, destination, { recursive: true, force: true, dereference: true });
    } else {
        fs.copyFileSync(source, destination);
    }
    return true;
}

function backupLocalOnlyProfileFiles(repoPath) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupDir = path.join(os.homedir(), `.zensync-local-only-backup-${ts}`);
    let count = 0;

    for (const relPath of LOCAL_ONLY_PROFILE_PATHS) {
        const source = path.join(repoPath, relPath);
        const destination = path.join(backupDir, relPath);
        if (copyPathIfExists(source, destination)) count++;
    }

    return count > 0 ? { backupDir, count } : { backupDir: null, count: 0 };
}

function restoreLocalOnlyProfileFiles(repoPath, backupDir) {
    if (!backupDir || !fs.existsSync(backupDir)) return 0;

    let count = 0;
    for (const relPath of LOCAL_ONLY_PROFILE_PATHS) {
        const source = path.join(backupDir, relPath);
        const destination = path.join(repoPath, relPath);
        if (copyPathIfExists(source, destination)) count++;
    }
    return count;
}

async function resetProfileRepoToOrigin(repoPath, branch = 'main') {
    const backup = backupLocalOnlyProfileFiles(repoPath);

    await execa('git', ['fetch', 'origin'], { cwd: repoPath });
    await execa('git', ['reset', '--hard', `origin/${branch}`], { cwd: repoPath });

    const restored = restoreLocalOnlyProfileFiles(repoPath, backup.backupDir);
    return { ...backup, restored };
}

async function isZenRunning() {
    const list = await psList();
    return list.some(p => {
        const name = p.name.toLowerCase();
        return name === 'zen' || name === 'zen.exe' || name === 'zen-bin' || name.includes('zen browser');
    });
}

async function ensureZenClosed(options = {}) {
    if (!(await isZenRunning())) return true;

    card([
        `${WARN('⚠️  Zen Browser is currently open')}`,
        ``,
        `${DIM('    Setup edits profile config and may pull profile files.')}`,
        `${DIM('    Close Zen first so your data stays consistent.')}`,
    ], chalk.yellow);
    gap();

    if (options.yes) {
        row('⏭️', WARN('Non-interactive setup stopped because Zen is open.'));
        return false;
    }

    const { waitForClose } = await inquirer.prompt([{
        type: 'confirm',
        name: 'waitForClose',
        message: 'Close Zen Browser now, then continue?',
        default: true,
        prefix: chalk.cyan('?'),
    }]);

    if (!waitForClose) return false;

    const s = spinner('Waiting for Zen Browser to close...');
    const deadline = Date.now() + 2 * 60 * 1000;
    while (Date.now() < deadline) {
        if (!(await isZenRunning())) {
            s.succeed('Zen Browser is closed.');
            return true;
        }
        await new Promise(r => setTimeout(r, 2000));
    }

    s.fail('Zen Browser is still running. Close it and run setup again.');
    return false;
}

// ─── UI Primitives ────────────────────────────────────────────────────

const DIM   = chalk.gray;
const CYAN  = chalk.cyan;
const OK    = chalk.green;
const WARN  = chalk.yellow;
const ERR   = chalk.red;
const BOLD  = chalk.bold.white;
const WIDTH = 60;

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
        const stripped = stripAnsi(l);
        const pad = inner - stripped.length;
        ln(borderColor('  │') + ' ' + l + ' '.repeat(Math.max(0, pad - 1)) + borderColor('│'));
    }
    ln(bot);
}

function spinner(text) {
    return ora({ text, color: 'cyan', spinner: 'dots', indent: 2 }).start();
}

async function runPreflight(options = {}) {
    const [git, gh, gitIdentity] = await Promise.all([
        detectGitStatus(),
        detectGithubCliStatus(),
        getGitIdentity()
    ]);

    card([
        `${git.installed ? '✅' : '❌'}  Git              ${git.installed ? OK('ready') : ERR('missing')}`,
        `${gh.installed
            ? (gh.authenticated ? '✅' : '⚠️')
            : '⚠️'}  GitHub CLI (gh)  ${gh.installed
            ? (gh.authenticated ? OK('ready') : WARN('needs login'))
            : WARN('not installed')}`,
        `${gitIdentity.configured ? '✅' : '⚠️'}  Git identity     ${gitIdentity.configured
            ? OK(`${gitIdentity.name || 'Configured'} <${gitIdentity.email}>`)
            : WARN('user.name / user.email not set')}`,
    ], git.installed ? chalk.cyan : chalk.red);
    gap();

    if (!git.installed) {
        card([
            `${ERR('Git is required before ZenSync can continue.')}`,
            '',
            `${DIM('Install Git, then run setup again.')}`,
            `${DIM('macOS with Homebrew:')} ${CYAN('brew install git')}`,
            `${DIM('Windows:')} ${CYAN('https://git-scm.com/download/win')}`,
        ], chalk.red);
        return { ok: false, git, gh, gitIdentity };
    }

    if (!gitIdentity.configured) {
        row('💡', DIM('Commits may fail later until Git identity is configured.'));
        row('  ', CYAN('git config --global user.name "Your Name"'));
        row('  ', CYAN('git config --global user.email "you@example.com"'));
        gap();
    }

    if (gh.installed && gh.authenticated) {
        row('🐙', gh.user
            ? `GitHub CLI is logged in as ${CYAN(gh.user)}`
            : OK('GitHub CLI is ready.'));
        return { ok: true, git, gh, gitIdentity };
    }

    card([
        `${WARN('GitHub CLI is not fully ready yet.')}`,
        '',
        `${DIM('ZenSync can still continue locally, but these steps')}`,
        `${DIM('will not work smoothly until gh is ready:')}`,
        `${DIM('  • creating a private GitHub repo automatically')}`,
        `${DIM('  • logging in quickly during onboarding')}`,
        '',
        gh.installed
            ? `${DIM('Next step:')} ${CYAN('gh auth login')}`
            : `${DIM('Install first:')} ${CYAN('brew install gh')} ${DIM('then')} ${CYAN('gh auth login')}`,
    ], chalk.yellow);
    gap();

    if (options.yes) {
        row('⚠️', WARN('Continuing without GitHub CLI because --yes was used.'));
        return { ok: true, git, gh, gitIdentity };
    }

    const { continueWithoutGh } = await inquirer.prompt([{
        type: 'confirm',
        name: 'continueWithoutGh',
        message: 'Continue setup anyway?',
        default: false,
        prefix: chalk.yellow('!')
    }]);

    return { ok: continueWithoutGh, git, gh, gitIdentity };
}

// ─── Phase 1: Welcome & Directory ─────────────────────────────────────

async function chooseDirectory(options) {
    const defaultPath = path.join(os.homedir(), 'zensync-data');
    if (options.yes) return defaultPath;

    const cwd = process.cwd();

    // Detect if we're already in a valid profile repo
    const isRepo = fs.existsSync(path.join(cwd, '.git'));
    const hasProfile = fs.existsSync(path.join(cwd, 'profile'));
    const isSourceRepo = fs.existsSync(path.join(cwd, 'src', 'cli.js'));

    if (isRepo && hasProfile && !isSourceRepo) {
        card([
            `📂  Found an existing ZenSync repo here`,
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
        `${DIM('ZenSync stores your browser profile in a separate data folder.')}`,
        `${DIM('This is usually NOT the ZenSync source-code repo.')}`,
        '',
        `${DIM('Recommended:')}  ${CYAN(shortPath(defaultPath))}`,
        '',
        `${DIM('Press')} ${BOLD('Enter')} ${DIM('to accept, or type a different path.')}`,
    ]);
    gap();

    const { installDir } = await inquirer.prompt([{
        type: 'input',
        name: 'installDir',
        message: 'Profile data folder:',
        default: defaultPath,
        prefix: chalk.cyan('?'),
        transformer: (input) => CYAN(input)
    }]);

    if (installDir.startsWith('~/') || installDir === '~') {
        return path.join(os.homedir(), installDir.slice(1));
    }
    return path.resolve(installDir);
}

// ─── Phase 2: Repository Setup ────────────────────────────────────────

async function refreshConfiguredRepo(repoPath, options = {}) {
    row('✅', OK('Using the current ZenSync repo.'));
    const s = spinner('Pulling latest profile snapshot...');
    try {
        const branch = (await execa('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: repoPath })).stdout.trim() || 'main';
        await execa('git', ['pull', '--rebase', '--autostash', 'origin', branch], { cwd: repoPath });
        s.succeed('Profile repo is up to date.');
    } catch (e) {
        s.warn('Could not pull cleanly. Remote history may have been compacted.');

        let shouldReset = options.yes;
        if (!options.yes) {
            gap();
            card([
                `${WARN('Reset tracked profile files to the latest cloud snapshot?')}`,
                '',
                `${DIM('ZenSync will first back up local-only sensitive files')}`,
                `${DIM('like cookies/password DBs, then restore them after reset.')}`,
            ], chalk.yellow);
            gap();

            const answer = await inquirer.prompt([{
                type: 'confirm',
                name: 'reset',
                message: 'Reset this profile repo to origin/main now?',
                default: true,
                prefix: chalk.cyan('?'),
            }]);
            shouldReset = answer.reset;
        }

        if (shouldReset) {
            const reset = spinner('Resetting profile repo safely...');
            try {
                const result = await resetProfileRepoToOrigin(repoPath, 'main');
                reset.succeed('Profile repo reset to latest cloud snapshot.');
                if (result.backupDir) {
                    row('🛡️', DIM(`Local-only backup: ${shortPath(result.backupDir)}`));
                    row('↩️', DIM(`Restored ${result.restored} local-only item(s).`));
                }
            } catch (resetError) {
                reset.fail('Safe reset failed: ' + resetError.message);
                row('💡', DIM('ZenSync will retry pulls in the background.'));
            }
        } else {
            row('💡', DIM('ZenSync will retry pulls in the background.'));
        }
    }
    return true;
}

async function promptFreshSetupAction() {
    card([
        BOLD('Pick the path that matches this machine:'),
        '',
        `${DIM('Answer')} ${BOLD('Yes')} ${DIM('if this machine should create a new profile repo.')}`,
        `${DIM('Answer')} ${BOLD('No')} ${DIM('if you already have a repo and want to connect to it.')}`,
        '',
        `✨  ${CYAN('Yes  → Start a brand-new ZenSync repo')}`,
        `📥  ${CYAN('No   → Connect to an existing ZenSync repo')}`,
    ]);
    gap();

    const { createNew } = await inquirer.prompt([{
        type: 'confirm',
        name: 'createNew',
        message: 'Start a brand-new ZenSync repo on this machine?',
        default: false,
        prefix: chalk.cyan('?')
    }]);

    gap();
    if (!createNew) {
        card([
            `${BOLD('Great — we will connect to your existing repo next.')}`,
            '',
            `${DIM('Have your Git URL ready (GitHub/GitLab URL).')}`,
        ]);
        return 'clone';
    }

    card([
        `${BOLD('Great — we will create a brand-new repo in your chosen folder.')}`,
        '',
        `${DIM('ZenSync can import your local Zen profile after repo creation.')}`,
    ]);
    return 'create';
}

function prepareReplacement(repoPath) {
    if (!fs.existsSync(repoPath)) return { needsReplacement: false, backupPath: null };
    if (isDirEmpty(repoPath)) return { needsReplacement: true, backupPath: null };
    return { needsReplacement: true, backupPath: makeBackupPath(repoPath) };
}

function replaceDirectory(repoPath, backupPath) {
    if (!fs.existsSync(repoPath)) return null;
    if (isDirEmpty(repoPath)) {
        fs.rmSync(repoPath, { recursive: true, force: true });
        return null;
    }
    return movePathToBackup(repoPath, backupPath);
}

function restoreReplacement(repoPath, backupPath) {
    if (!backupPath) return;
    if (fs.existsSync(repoPath)) return;
    if (!fs.existsSync(backupPath)) return;
    fs.renameSync(backupPath, repoPath);
}

async function setupRepository(repoPath, options = {}) {
    const isGit = fs.existsSync(path.join(repoPath, '.git'));
    const hasProfile = fs.existsSync(path.join(repoPath, 'profile'));
    const empty = isDirEmpty(repoPath);

    if (isGit && hasProfile) {
        const origin = await getOriginUrl(repoPath);
        card([
            `${OK('This folder already looks like a ZenSync repo.')}`,
            '',
            `${DIM('Folder:')}  ${CYAN(shortPath(repoPath))}`,
            `${DIM('Remote:')}  ${origin ? CYAN(origin) : DIM('none configured yet')}`,
            `${DIM('Profile:')} ${profileHasData(repoPath) ? OK('has data') : WARN('empty')}`,
            '',
            `${DIM('You can keep it, reconnect it to a different repo,')}`,
            `${DIM('or start over cleanly with a backup.')}`,
        ], chalk.green);
        gap();

        const { action } = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: 'What do you want to do with this existing setup?',
            prefix: chalk.cyan('?'),
            choices: [
                { name: `✅  Keep this repo and continue`, value: 'keep' },
                { name: `📥  Replace it with a clone of my existing GitHub repo`, value: 'clone' },
                { name: `✨  Start over with a brand-new ZenSync repo here`, value: 'create' },
            ]
        }]);

        if (action === 'keep') return await refreshConfiguredRepo(repoPath, options);
        if (action === 'clone') return await cloneExistingRepo(repoPath, { ...options, replaceExisting: true });
        return await createNewRepo(repoPath, { ...options, replaceExisting: true });
    }

    if (isGit && !hasProfile) {
        card([
            `${WARN('This folder is already a Git repo, but not a ZenSync repo yet.')}`,
            '',
            `${DIM('ZenSync expects a')} ${CYAN('profile/')} ${DIM('folder here.')}`,
            `${DIM('If this repo was created by mistake, you can safely start over.')}`,
        ], chalk.yellow);
        gap();

        const { action } = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: 'How should ZenSync fix this folder?',
            prefix: chalk.cyan('?'),
            choices: [
                { name: `📥  Replace this folder with a clone of my existing ZenSync repo`, value: 'clone' },
                { name: `✨  Start over and turn this folder into a new ZenSync repo`, value: 'create' },
                { name: `↩️  Cancel for now`, value: 'cancel' },
            ]
        }]);

        if (action === 'cancel') return false;
        if (action === 'clone') return await cloneExistingRepo(repoPath, { ...options, replaceExisting: true });
        return await createNewRepo(repoPath, { ...options, replaceExisting: true });
    }

    if (!empty && !isGit) {
        card([
            `${WARN('This folder already has files in it.')}`,
            '',
            `${DIM('ZenSync can still use this location, but it should not mix')}`,
            `${DIM('with unrelated files. We recommend backing it up first.')}`,
        ], chalk.yellow);
        gap();

        const { action } = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: 'What would you like to do?',
            prefix: chalk.cyan('?'),
            choices: [
                { name: `📥  Back up this folder and clone my existing ZenSync repo here`, value: 'clone' },
                { name: `✨  Back up this folder and start a new ZenSync repo here`, value: 'create' },
                { name: `↩️  Cancel and choose a different folder later`, value: 'cancel' },
            ]
        }]);

        if (action === 'cancel') return false;
        if (action === 'clone') return await cloneExistingRepo(repoPath, { ...options, replaceExisting: true });
        return await createNewRepo(repoPath, { ...options, replaceExisting: true });
    }

    const action = await promptFreshSetupAction();
    if (!action) return false;

    if (action === 'clone') return await cloneExistingRepo(repoPath, options);
    return await createNewRepo(repoPath, options);
}

async function cloneExistingRepo(repoPath, options = {}) {
    gap();
    card([
        `${DIM('Paste the URL of your existing ZenSync repo.')}`,
        '',
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
            if (!input.includes('github.com') && !input.includes('gitlab.com') && !input.includes('git@') && !input.includes('https://')) {
                return 'That does not look like a Git URL yet. Paste the full repo URL.';
            }
            return true;
        }
    }]);

    const replacement = options.replaceExisting ? prepareReplacement(repoPath) : { needsReplacement: false, backupPath: null };

    if (replacement.needsReplacement && !options.yes) {
        gap();
        card([
            `${WARN('This will replace the current contents of your chosen folder.')}`,
            '',
            `${DIM('Folder:')}  ${CYAN(shortPath(repoPath))}`,
            replacement.backupPath
                ? `${DIM('Backup:')}  ${CYAN(shortPath(replacement.backupPath))}`
                : `${DIM('Backup:')}  ${DIM('not needed — the folder is empty')}`,
        ], chalk.yellow);
        gap();

        const { confirmReplace } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmReplace',
            message: 'Backup/replace this folder and clone the repo?',
            default: false,
            prefix: chalk.yellow('!')
        }]);

        if (!confirmReplace) return false;
    }

    gap();
    const s = spinner(replacement.needsReplacement
        ? 'Backing up current folder and cloning repo...'
        : 'Cloning your profile repository...');

    let movedBackupPath = null;
    try {
        const parentDir = path.dirname(repoPath);
        const dirName = path.basename(repoPath);

        fs.mkdirSync(parentDir, { recursive: true });
        movedBackupPath = replaceDirectory(repoPath, replacement.backupPath);

        if (!replacement.needsReplacement && isDirEmpty(repoPath)) {
            fs.rmSync(repoPath, { recursive: true, force: true });
        }

        await execa('git', ['clone', repoUrl, dirName], { cwd: parentDir });

        if (!fs.existsSync(repoPath) || !fs.existsSync(path.join(repoPath, '.git'))) {
            s.fail('Clone failed — directory is missing after clone.');
            row('💡', DIM('Try manually: ') + CYAN(`git clone ${repoUrl} ${repoPath}`));
            restoreReplacement(repoPath, movedBackupPath);
            return false;
        }

        if (profileHasData(repoPath)) {
            const count = fs.readdirSync(path.join(repoPath, 'profile')).length;
            s.succeed(OK(`Connected! Profile loaded with ${count} items.`));
        } else {
            s.succeed(OK('Connected to the repo.'));
            row('⚠️', WARN('The profile folder in this repo is empty.'));
            row('  ', DIM('Push profile data from another device, then run setup again if needed.'));
        }

        if (movedBackupPath) {
            row('🛟', DIM(`Previous folder backed up to ${shortPath(movedBackupPath)}`));
        }
        return true;

    } catch (error) {
        restoreReplacement(repoPath, movedBackupPath);
        s.fail('Clone failed.');
        gap();
        if (error.message.includes('not found') || error.message.includes('404')) {
            row('💡', 'Repository not found. Check the URL and try again.');
        } else if (error.message.includes('Authentication') || error.message.includes('403')) {
            row('💡', 'Access denied. Make sure GitHub CLI or your Git credentials are set up.');
            row('  ', CYAN('gh auth login'));
        } else {
            row('💡', DIM(error.shortMessage || error.message));
        }
        return false;
    }
}

async function createNewRepo(repoPath, options = {}) {
    const replacement = options.replaceExisting ? prepareReplacement(repoPath) : { needsReplacement: false, backupPath: null };

    if (replacement.needsReplacement && !options.yes) {
        gap();
        card([
            `${WARN('This will replace the current contents of your chosen folder.')}`,
            '',
            `${DIM('Folder:')}  ${CYAN(shortPath(repoPath))}`,
            replacement.backupPath
                ? `${DIM('Backup:')}  ${CYAN(shortPath(replacement.backupPath))}`
                : `${DIM('Backup:')}  ${DIM('not needed — the folder is empty')}`,
        ], chalk.yellow);
        gap();

        const { confirmReplace } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirmReplace',
            message: 'Backup/replace this folder and start over?',
            default: false,
            prefix: chalk.yellow('!')
        }]);

        if (!confirmReplace) return false;
    }

    gap();
    const s = spinner(replacement.needsReplacement
        ? 'Backing up current folder and creating a new repo...'
        : 'Initializing repository...');

    let movedBackupPath = null;
    try {
        movedBackupPath = replaceDirectory(repoPath, replacement.backupPath);

        if (!fs.existsSync(repoPath)) fs.mkdirSync(repoPath, { recursive: true });

        try {
            await execa('git', ['init', '-b', 'main'], { cwd: repoPath });
        } catch {
            await execa('git', ['init'], { cwd: repoPath });
            await execa('git', ['branch', '-M', 'main'], { cwd: repoPath });
        }

        const profilePath = path.join(repoPath, 'profile');
        if (!fs.existsSync(profilePath)) fs.mkdirSync(profilePath);

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

        fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
            name: 'my-zen-profile',
            version: '1.0.0',
            description: 'Zen Browser profile managed by ZenSync',
            scripts: { setup: 'zensync setup', sync: 'zensync watch' },
            dependencies: {}
        }, null, 2));

        s.succeed('Repository initialized.');
        if (movedBackupPath) {
            row('🛟', DIM(`Previous folder backed up to ${shortPath(movedBackupPath)}`));
        }

        const localProfile = findLocalZenProfile();
        if (localProfile) {
            gap();
            card([
                `🔍  ${BOLD('Found your Zen Browser profile!')}`,
                '',
                `    ${CYAN(shortPath(localProfile))}`,
                '',
                `${DIM('We can copy your bookmarks, extensions, settings')}`,
                `${DIM('and other data into the repo now.')}`,
            ]);
            gap();

            const { importProfile } = await inquirer.prompt([{
                type: 'confirm',
                name: 'importProfile',
                message: 'Import your browser data into this new repo?',
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
            row('  ', DIM('Open Zen Browser at least once, then re-run setup if you want to import it.'));
        }

        gap();
        const s3 = spinner('Creating initial commit...');
        await execa('git', ['add', '.'], { cwd: repoPath });
        try {
            await execa('git', ['commit', '-m', 'Initial profile setup via ZenSync'], { cwd: repoPath });
            s3.succeed('Initial commit created.');
        } catch (error) {
            s3.fail('Initial commit failed.');
            const details = [error.stderr, error.stdout, error.shortMessage, error.message].filter(Boolean).join(' | ');
            if (details.includes('Please tell me who you are') || details.includes('unable to auto-detect email address')) {
                row('💡', DIM('Git needs your name/email before it can create commits.'));
                row('  ', CYAN('git config --global user.name "Your Name"'));
                row('  ', CYAN('git config --global user.email "you@example.com"'));
            } else {
                row('💡', DIM(details));
            }
            return false;
        }

        const gh = options.preflight?.gh || await detectGithubCliStatus();

        gap();
        if (!gh.installed || !gh.authenticated) {
            card([
                `${WARN('Skipping automatic GitHub repo creation for now.')}`,
                '',
                `${DIM('Reason:')} ${DIM(!gh.installed ? 'GitHub CLI is not installed.' : 'GitHub CLI is not logged in.')}`,
                `${DIM('When you are ready:')}`,
                !gh.installed
                    ? `${CYAN('brew install gh')} ${DIM('then')} ${CYAN('gh auth login')}`
                    : `${CYAN('gh auth login')}`,
                `${DIM('Then re-run')} ${CYAN('zensync setup')} ${DIM('or push manually.')}`,
            ], chalk.yellow);
            return true;
        }

        card([
            `🐙  ${BOLD('Create a private GitHub repo now?')}`,
            '',
            `${DIM('ZenSync detected that GitHub CLI is ready.')}`,
            `${DIM('We can create a private repo and push this profile')}`,
            `${DIM('so your other machines can connect to it.')}`,
        ]);
        gap();

        const { setupGithub } = await inquirer.prompt([{
            type: 'confirm',
            name: 'setupGithub',
            message: 'Create and push a private GitHub repo?',
            default: true,
            prefix: chalk.cyan('?'),
        }]);

        if (setupGithub) {
            const { repoName } = await inquirer.prompt([{
                type: 'input',
                name: 'repoName',
                message: 'Repo name:',
                default: 'zen-profile-data',
                prefix: chalk.cyan('?'),
            }]);

            const s4 = spinner('Creating private repository on GitHub...');
            try {
                await execa('gh', ['repo', 'create', repoName, '--private', '--source=.', '--remote=origin', '--push'], { cwd: repoPath });
                const user = gh.user || (await execa('gh', ['api', 'user', '--jq', '.login'])).stdout.trim();
                s4.succeed(OK('Created: ') + CYAN(`github.com/${user}/${repoName}`));
            } catch (e) {
                s4.fail('GitHub setup failed.');
                row('💡', DIM(e.stderr || e.shortMessage || e.message));
                row('  ', DIM('No worries — you can push manually later.'));
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

    const backupPath = `${filePath}.zensync-backup-${makeTimestamp()}`;
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
            `${ERR('🚨  Your repo profile folder is empty')}`,
            '',
            `${DIM('Linking right now would make Zen Browser point at an')}`,
            `${DIM('empty profile folder, which is usually not what you want.')}`,
            '',
            `${DIM('This often means:')}`,
            `${DIM('  • you cloned the repo before any profile data was pushed')}`,
            `${DIM('  • or you created a new repo but skipped profile import')}`,
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
            row('  ', DIM('Import or push profile data first, then run zensync setup again.'));
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
    const T = 5;

    gap();
    card([
        '',
        `       ${chalk.bold('🧘  ZenSync  Setup  Wizard  🧘')}`,
        '',
        `   ${DIM('Sync your Zen Browser profile across devices.')}`,
        `   ${DIM('We will check Git/GitHub first, then guide you through setup.')}`,
        '',
    ]);

    step(1, T, '🧪', 'Preflight Checks');
    const preflight = await runPreflight(options);
    if (!preflight.ok) {
        gap();
        card([
            `${WARN('Setup stopped before any files were changed.')}`,
            '',
            `${DIM('Fix the issue above, then run:')}`,
            `    ${CYAN('zensync setup')}`,
        ], chalk.yellow);
        gap();
        return;
    }

    const safeToContinue = await ensureZenClosed(options);
    if (!safeToContinue) {
        gap();
        card([
            `${WARN('Setup paused.')}`,
            '',
            `${DIM('Close Zen Browser and run:')} ${CYAN('zensync setup')}`,
        ], chalk.yellow);
        gap();
        return;
    }

    step(2, T, '📁', 'Storage Location');
    const repoPath = await chooseDirectory(options);

    if (!fs.existsSync(repoPath)) {
        const s = spinner(`Creating ${shortPath(repoPath)}...`);
        fs.mkdirSync(repoPath, { recursive: true });
        s.succeed(`Directory ready: ${CYAN(shortPath(repoPath))}`);
    } else {
        row('📂', `Using: ${CYAN(shortPath(repoPath))}`);
    }
    row('📝', DIM('Selection noted. We will save it after setup succeeds.'));

    step(3, T, '📦', 'Profile Repository');
    const ready = await setupRepository(repoPath, { ...options, preflight });
    if (!ready) {
        gap();
        card([
            `${ERR('❌  Setup could not be completed.')}`,
            '',
            `${DIM('Nothing was linked yet. Fix the issue above and run:')}`,
            `    ${CYAN('zensync setup')}`,
        ], chalk.red);
        gap();
        return;
    }

    config.set('repoPath', repoPath);
    row('💾', OK('Saved repo path.'));

    step(4, T, '🔗', 'Browser Link');
    process.chdir(repoPath);
    await linkProfile(repoPath);

    step(5, T, '⚙️', 'Background Sync');

    let shouldEnableStartup = options.startup !== false;
    if (!options.yes && shouldEnableStartup) {
        const answer = await inquirer.prompt([{
            type: 'confirm',
            name: 'enable',
            message: 'Start ZenSync automatically when you log in?',
            default: true,
            prefix: chalk.cyan('?'),
        }]);
        shouldEnableStartup = answer.enable;
    }

    if (shouldEnableStartup) {
        await enableStartup();
    } else {
        row('⏭️', DIM('Startup skipped.'));
    }

    let shouldStartNow = options.start !== false;
    if (!options.yes && shouldStartNow) {
        const answer = await inquirer.prompt([{
            type: 'confirm',
            name: 'start',
            message: 'Start/restart ZenSync in the background now?',
            default: true,
            prefix: chalk.cyan('?'),
        }]);
        shouldStartNow = answer.start;
    }

    if (shouldStartNow) {
        const status = getDaemonStatus();
        if (status.isRunning) stopDaemon();
        startDaemon();
    } else {
        row('⏭️', DIM('Background watcher not started.'));
    }

    gap();
    const ok = profileHasData(repoPath);
    card(ok ? [
        '',
        `   🎉  ${chalk.bold.green('All done! ZenSync is ready.')}`,
        '',
        `   ${DIM('Your profile is synced and linked.')}`,
        `   ${DIM('ZenSync runs quietly in the background.')}`,
        '',
    ] : [
        '',
        `   ⚡  ${chalk.bold.yellow('Setup finished, but you still need profile data.')}`,
        '',
        `   ${DIM('Your folder exists, but the repo profile is empty.')}`,
        `   ${DIM('Push data from another device or run setup again to import it.')}`,
        '',
    ], ok ? chalk.green : chalk.yellow);

    gap();
    row('📂', `Data:    ${CYAN(shortPath(repoPath))}`);
    row('🔁', `Setup:   ${CYAN('zensync setup')}`);
    row('🚀', `Sync:    ${CYAN('background watcher')}`);
    row('📊', `Status:  ${CYAN('zensync status')}`);
    gap();
    line();
    gap();
}
