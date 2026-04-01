import fs from 'fs';
import path from 'path';
import { execa } from 'execa';

const formatGitError = (error) => {
    const stderr = error?.stderr?.trim();
    const short = error?.shortMessage?.trim();
    const message = error?.message?.trim();

    const details = [stderr, short, message].filter(Boolean);
    return details.length ? details.join(' | ') : 'Unknown git error';
};

function getGitMetaPath(cwd, name) {
    return path.join(cwd, '.git', name);
}

function isClearlyStaleRebaseDir(dirPath) {
    if (!fs.existsSync(dirPath)) return false;

    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) return true;

    // We've observed interrupted pulls leaving only "autostash" behind.
    if (entries.length === 1 && entries[0] === 'autostash') return true;

    return false;
}

function cleanupStaleRebaseState(cwd) {
    const rebaseMerge = getGitMetaPath(cwd, 'rebase-merge');
    const rebaseApply = getGitMetaPath(cwd, 'rebase-apply');

    let cleaned = false;

    for (const dirPath of [rebaseMerge, rebaseApply]) {
        if (isClearlyStaleRebaseDir(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            cleaned = true;
        }
    }

    return cleaned;
}

function cleanupStaleIndexLock(cwd, maxAgeMs = 2 * 60 * 1000) {
    const lockPath = getGitMetaPath(cwd, 'index.lock');
    if (!fs.existsSync(lockPath)) return false;

    try {
        const stat = fs.statSync(lockPath);
        const ageMs = Date.now() - stat.mtimeMs;

        if (ageMs >= maxAgeMs) {
            fs.rmSync(lockPath, { force: true });
            return true;
        }
    } catch {
        // Best-effort cleanup only.
    }

    return false;
}

function cleanupStaleMergeAutostash(cwd, maxAgeMs = 30 * 1000) {
    const autoStashRef = getGitMetaPath(cwd, 'MERGE_AUTOSTASH');
    if (!fs.existsSync(autoStashRef)) return false;

    const hasActiveMergeOrRebase =
        fs.existsSync(getGitMetaPath(cwd, 'MERGE_HEAD')) ||
        fs.existsSync(getGitMetaPath(cwd, 'rebase-merge')) ||
        fs.existsSync(getGitMetaPath(cwd, 'rebase-apply'));

    if (hasActiveMergeOrRebase) return false;

    try {
        const stat = fs.statSync(autoStashRef);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs < maxAgeMs) return false;
    } catch {
        // If we can't read metadata, still attempt best-effort cleanup.
    }

    try {
        fs.rmSync(autoStashRef, { force: true });
        return true;
    } catch {
        return false;
    }
}

function uniqueNonEmpty(items = []) {
    return [...new Set(items.map(item => String(item || '').trim()).filter(Boolean))];
}

function makeRecoveryDir(cwd, label = 'recovery') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const recoveryDir = path.join(cwd, '.zensync-recovery', `${label}-${timestamp}`);
    fs.mkdirSync(recoveryDir, { recursive: true });
    return recoveryDir;
}

function backupPaths(cwd, files = [], recoveryDir) {
    const copied = [];

    for (const relPath of uniqueNonEmpty(files)) {
        const source = path.join(cwd, relPath);
        if (!fs.existsSync(source)) continue;

        const destination = path.join(recoveryDir, relPath);
        fs.mkdirSync(path.dirname(destination), { recursive: true });

        try {
            const stat = fs.lstatSync(source);
            if (stat.isDirectory()) {
                fs.cpSync(source, destination, { recursive: true, force: true, dereference: true });
            } else {
                fs.copyFileSync(source, destination);
            }
            copied.push(relPath);
        } catch {
            // Best-effort backup.
        }
    }

    return copied;
}

function parseUntrackedOverwritePaths(errorText = '') {
    if (!errorText) return [];

    const lines = String(errorText).split(/\r?\n/);
    const start = lines.findIndex(line => line.includes('would be overwritten by merge'));
    if (start === -1) return [];

    const files = [];

    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line) continue;
        if (line.startsWith('Please move or remove')) break;
        if (line.startsWith('Aborting')) break;
        if (line.startsWith('Updating ')) break;

        // Ignore obvious non-path lines.
        if (line.startsWith('error:') || line.startsWith('hint:') || line.startsWith('From ')) {
            continue;
        }

        files.push(line.replace(/^\t+/, '').trim());
    }

    return uniqueNonEmpty(files);
}

export function isUnmergedConflictError(errorText = '') {
    const text = String(errorText).toLowerCase();
    return text.includes('unmerged files') || text.includes('unresolved conflict');
}

export function isUntrackedOverwriteError(errorText = '') {
    const text = String(errorText).toLowerCase();
    return text.includes('untracked working tree files would be overwritten by merge');
}

export async function gitAdd(cwd) {
    cleanupStaleIndexLock(cwd);
    await execa('git', ['add', '.'], { cwd });
}

export async function gitCommit(cwd, message) {
    try {
        await execa('git', ['commit', '-m', message], { cwd });
        return { success: true };
    } catch (error) {
        return { success: false, error: formatGitError(error) };
    }
}

export async function gitPush(cwd) {
    try {
        await execa('git', ['push'], { cwd });
        return { success: true };
    } catch (error) {
        return { success: false, error: formatGitError(error) };
    }
}

export async function gitPull(cwd) {
    cleanupStaleRebaseState(cwd);
    cleanupStaleIndexLock(cwd);
    cleanupStaleMergeAutostash(cwd);

    const branch = await getCurrentBranch(cwd);
    const args = branch
        ? ['pull', '--rebase', '--autostash', 'origin', branch]
        : ['pull', '--rebase', '--autostash'];

    try {
        await execa('git', args, { cwd });
        return { success: true };
    } catch (error) {
        const firstError = formatGitError(error);

        // We've observed interrupted autostash runs leaving this ref behind.
        // Clean and retry once automatically.
        if (firstError.includes('MERGE_AUTOSTASH')) {
            const cleaned = cleanupStaleMergeAutostash(cwd, 0);
            if (cleaned) {
                try {
                    cleanupStaleRebaseState(cwd);
                    cleanupStaleIndexLock(cwd);
                    await execa('git', args, { cwd });
                    return { success: true };
                } catch (retryError) {
                    return { success: false, error: formatGitError(retryError) };
                }
            }
        }

        // Common on profile repos with rotating untracked files.
        // Move conflicting files to recovery and retry once.
        if (isUntrackedOverwriteError(firstError)) {
            const recovered = await recoverUntrackedOverwriteConflict(cwd, firstError);
            if (recovered.success && recovered.recovered) {
                try {
                    cleanupStaleRebaseState(cwd);
                    cleanupStaleIndexLock(cwd);
                    await execa('git', args, { cwd });
                    return {
                        success: true,
                        recovered: true,
                        recoveryDir: recovered.recoveryDir,
                        movedPaths: recovered.paths
                    };
                } catch (retryError) {
                    return { success: false, error: formatGitError(retryError) };
                }
            }
        }

        return { success: false, error: firstError };
    }
}

export async function hasChanges(cwd) {
    const { stdout } = await execa('git', ['status', '--porcelain'], { cwd });
    return stdout.length > 0;
}

export async function getCurrentBranch(cwd) {
    try {
        const { stdout } = await execa('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd });
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

export async function getUnmergedPaths(cwd) {
    try {
        const { stdout } = await execa('git', ['ls-files', '-u'], { cwd });
        if (!stdout.trim()) return [];

        const paths = stdout
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => line.split(/\s+/).slice(3).join(' ').trim());

        return uniqueNonEmpty(paths);
    } catch {
        return [];
    }
}

export async function hasUnmergedPaths(cwd) {
    const paths = await getUnmergedPaths(cwd);
    return paths.length > 0;
}

async function getDirtyPaths(cwd) {
    try {
        const { stdout } = await execa('git', ['status', '--porcelain'], { cwd });
        if (!stdout.trim()) return [];

        const paths = stdout
            .split(/\r?\n/)
            .map(line => line.trimEnd())
            .filter(Boolean)
            .map(line => {
                const rawPath = line.slice(3).trim();
                if (!rawPath) return null;

                // Renames: "old -> new". Keep the destination path.
                const renameParts = rawPath.split(' -> ');
                return renameParts[renameParts.length - 1].replace(/^"|"$/g, '');
            })
            .filter(Boolean);

        return uniqueNonEmpty(paths);
    } catch {
        return [];
    }
}

export async function recoverUnmergedConflictState(cwd) {
    const unmergedPaths = await getUnmergedPaths(cwd);
    if (unmergedPaths.length === 0) {
        return { success: true, recovered: false, paths: [] };
    }

    const dirtyPaths = await getDirtyPaths(cwd);
    const pathsToBackup = uniqueNonEmpty([...dirtyPaths, ...unmergedPaths]);

    const recoveryDir = makeRecoveryDir(cwd, 'unmerged');
    const backedUp = backupPaths(cwd, pathsToBackup, recoveryDir);

    try {
        await execa('git', ['reset', '--hard', 'HEAD'], { cwd });
        cleanupStaleRebaseState(cwd);
        cleanupStaleIndexLock(cwd, 0);

        return {
            success: true,
            recovered: true,
            recoveryDir,
            paths: backedUp
        };
    } catch (error) {
        return {
            success: false,
            recovered: true,
            recoveryDir,
            paths: backedUp,
            error: formatGitError(error)
        };
    }
}

export async function recoverUntrackedOverwriteConflict(cwd, errorText = '') {
    const conflictingPaths = parseUntrackedOverwritePaths(errorText);
    if (conflictingPaths.length === 0) {
        return { success: false, recovered: false, paths: [] };
    }

    const recoveryDir = makeRecoveryDir(cwd, 'untracked-overwrite');
    const backedUp = backupPaths(cwd, conflictingPaths, recoveryDir);

    for (const relPath of conflictingPaths) {
        try {
            fs.rmSync(path.join(cwd, relPath), { recursive: true, force: true });
        } catch {
            // Best-effort cleanup.
        }
    }

    return {
        success: true,
        recovered: true,
        recoveryDir,
        paths: backedUp
    };
}

export async function isRebaseInProgress(cwd) {
    const hasRebaseDirs =
        fs.existsSync(getGitMetaPath(cwd, 'rebase-merge')) ||
        fs.existsSync(getGitMetaPath(cwd, 'rebase-apply'));

    if (hasRebaseDirs) return true;

    try {
        await execa('git', ['rev-parse', '--quiet', '--verify', 'REBASE_HEAD'], { cwd });
        return true;
    } catch {
        return false;
    }
}

export async function gitAbortRebase(cwd) {
    try {
        await execa('git', ['rebase', '--abort'], { cwd });
        return { success: true };
    } catch (error) {
        // If this was just stale git metadata, clean it and move on.
        const cleaned = cleanupStaleRebaseState(cwd) || cleanupStaleMergeAutostash(cwd);
        if (cleaned) {
            return { success: true };
        }

        return { success: false, error: formatGitError(error) };
    }
}
