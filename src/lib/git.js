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
