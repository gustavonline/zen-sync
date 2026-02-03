import { execa } from 'execa';
import chalk from 'chalk';

export async function gitAdd(cwd) {
    await execa('git', ['add', '.'], { cwd });
}

export async function gitCommit(cwd, message) {
    try {
        await execa('git', ['commit', '-m', message], { cwd });
        return true;
    } catch (e) {
        return false;
    }
}

export async function gitPush(cwd) {
    try {
        await execa('git', ['push'], { cwd });
        return true;
    } catch (e) {
        console.error(chalk.red('Push failed:'), e.shortMessage);
        return false;
    }
}

export async function gitPull(cwd) {
    try {
        await execa('git', ['pull', '--rebase', '--autostash'], { cwd });
        return true;
    } catch (e) {
        return false;
    }
}

export async function hasChanges(cwd) {
    const { stdout } = await execa('git', ['status', '--porcelain'], { cwd });
    return stdout.length > 0;
}
