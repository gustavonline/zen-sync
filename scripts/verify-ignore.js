import { execa } from 'execa';
import chalk from 'chalk';

async function isIgnored(file) {
    try {
        await execa('git', ['check-ignore', file]);
        return true;
    } catch {
        return false;
    }
}

async function checkIgnored(file) {
    if (await isIgnored(file)) {
        console.log(chalk.green('✅ ' + file + ' is ignored.'));
        return;
    }

    console.log(chalk.red('❌ ' + file + ' is NOT ignored.'));
    process.exit(1);
}

async function checkNotIgnored(file) {
    if (!(await isIgnored(file))) {
        console.log(chalk.green('✅ ' + file + ' is syncable.'));
        return;
    }

    console.log(chalk.red('❌ ' + file + ' is ignored but should sync.'));
    process.exit(1);
}

async function checkNotTracked(file) {
    const { stdout } = await execa('git', ['ls-files', file]);
    if (stdout.trim() === '') {
        console.log(chalk.green('✅ ' + file + ' is not tracked.'));
        return;
    }

    console.log(chalk.red('❌ ' + file + ' is tracked.'));
    process.exit(1);
}

async function run() {
    console.log('🔍 Verifying ZenSync profile-data ignore policy...');

    const localOnly = [
        'profile/cookies.sqlite',
        'profile/places.sqlite',
        'profile/favicons.sqlite',
        'profile/formhistory.sqlite',
        'profile/key4.db',
        'profile/logins.json',
        'profile/cert9.db',
        'profile/storage/example.sqlite',
        'profile/cache2/entries/example',
        'profile/gmp/example',
        'profile/AlternateServices.bin'
    ];

    const syncableSession = [
        'profile/sessionstore.jsonlz4',
        'profile/sessionstore-backups/recovery.jsonlz4',
        'profile/zen-sessions.jsonlz4',
        'profile/zen-sessions-backup/clean.jsonlz4'
    ];

    for (const file of localOnly) {
        await checkIgnored(file);
        await checkNotTracked(file);
    }

    for (const file of syncableSession) {
        await checkNotIgnored(file);
    }

    console.log(chalk.bold.green('\n🎉 ZenSync ignore policy looks correct.'));
}

run();
