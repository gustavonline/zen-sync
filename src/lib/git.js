import { execa } from 'execa';

const formatGitError = (error) => {
    return error?.shortMessage || error?.stderr || error?.message || 'Unknown git error';
};

export async function gitAdd(cwd) {
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
    try {
        await execa('git', ['pull', '--rebase', '--autostash'], { cwd });
        return { success: true };
    } catch (error) {
        return { success: false, error: formatGitError(error) };
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
        return { success: false, error: formatGitError(error) };
    }
}
