import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execa } from 'execa';

const CLIENT_LOCK_FILENAME = '.zensync-client.json';

function getToolRoot() {
    const currentFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(currentFile), '..', '..');
}

function readPackageVersion(toolRoot) {
    try {
        const packagePath = path.join(toolRoot, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        return pkg.version || '0.0.0';
    } catch {
        return '0.0.0';
    }
}

async function readToolCommit(toolRoot) {
    try {
        const { stdout } = await execa('git', ['rev-parse', '--short', 'HEAD'], { cwd: toolRoot });
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

function readRequiredClient(repoPath) {
    const lockPath = path.join(repoPath, CLIENT_LOCK_FILENAME);
    if (!fs.existsSync(lockPath)) return null;

    try {
        const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (!parsed || typeof parsed !== 'object') return null;

        return {
            version: typeof parsed.version === 'string' ? parsed.version : null,
            commit: typeof parsed.commit === 'string' ? parsed.commit : null
        };
    } catch {
        return null;
    }
}

function parseSemver(input = '0.0.0') {
    const [major = '0', minor = '0', patch = '0'] = input.split('.');
    return [major, minor, patch].map(part => {
        const numeric = Number.parseInt(String(part).replace(/\D.*$/, ''), 10);
        return Number.isFinite(numeric) ? numeric : 0;
    });
}

function compareSemver(a, b) {
    const pa = parseSemver(a);
    const pb = parseSemver(b);

    for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return 1;
        if (pa[i] < pb[i]) return -1;
    }
    return 0;
}

async function isCommitAtLeast(toolRoot, requiredCommit, localCommit) {
    if (!requiredCommit || !localCommit) return false;
    if (requiredCommit === localCommit) return true;

    try {
        await execa('git', ['merge-base', '--is-ancestor', requiredCommit, localCommit], { cwd: toolRoot });
        return true;
    } catch {
        return false;
    }
}

async function evaluateCompatibility(toolRoot, local, required) {
    // NPM installs do not have a git commit to verify. Version is the canonical
    // compatibility gate; commit is accepted only as a legacy/development hint.
    if (required?.version) {
        const cmp = compareSemver(local.version, required.version);
        if (cmp < 0) {
            return {
                ok: false,
                reason: `Repo requires ZenSync version ${required.version}+, but local is ${local.version}. Please update ZenSync and restart.`
            };
        }

        return { ok: true };
    }

    if (required?.commit && local.commit) {
        const commitOk = await isCommitAtLeast(toolRoot, required.commit, local.commit);
        if (!commitOk) {
            return {
                ok: false,
                reason: `Repo requires ZenSync commit ${required.commit} (or newer), but local is ${local.commit}. Run 'git pull' in zen-sync and restart.`
            };
        }
    }

    return { ok: true };
}

function writeRequiredClient(repoPath, local) {
    const lockPath = path.join(repoPath, CLIENT_LOCK_FILENAME);
    const data = {
        version: local.version
    };

    const nextText = `${JSON.stringify(data, null, 2)}\n`;
    const currentText = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : null;

    if (currentText === nextText) {
        return { changed: false, lockPath, data };
    }

    fs.writeFileSync(lockPath, nextText, 'utf8');
    return { changed: true, lockPath, data };
}

export async function enforceClientVersionGate(repoPath) {
    const toolRoot = getToolRoot();

    const local = {
        version: readPackageVersion(toolRoot),
        commit: await readToolCommit(toolRoot)
    };

    const required = readRequiredClient(repoPath);
    if (required) {
        const verdict = await evaluateCompatibility(toolRoot, local, required);
        if (!verdict.ok) {
            return {
                ok: false,
                reason: verdict.reason,
                local,
                required,
                lockPath: path.join(repoPath, CLIENT_LOCK_FILENAME)
            };
        }
    }

    const stamped = writeRequiredClient(repoPath, local);

    return {
        ok: true,
        changed: stamped.changed,
        local,
        required,
        lockPath: stamped.lockPath
    };
}
