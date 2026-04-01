import { execa } from 'execa';
import chalk from 'chalk';

async function checkIgnore(file) {
    try {
        await execa('git', ['check-ignore', file]);
        console.log(chalk.green('✅ ' + file + ' is correctly ignored.'));
    } catch {
        console.log(chalk.red('❌ ' + file + ' is NOT ignored!'));
        process.exit(1);
    }
}

async function checkTracked(file) {
    const { stdout } = await execa('git', ['ls-files', file]);
    if (stdout.trim() === '') {
        console.log(chalk.green('✅ ' + file + ' is correctly removed from tracking.'));
    } else {
        console.log(chalk.red('❌ ' + file + ' is STILL tracked!'));
        process.exit(1);
    }
}

async function run() {
    console.log('🔍 Verifying Git Configuration...');
    
    const files = [
        'profile/cookies.sqlite',
        'profile/places.sqlite',
        'profile/favicons.sqlite',
        'profile/sessionstore-backups/recovery.jsonlz4',
        'profile/zen-sessions.jsonlz4',
        'profile/AlternateServices.bin'
    ];

    for (const file of files) {
        await checkIgnore(file);
        await checkTracked(file);
    }
    
    console.log(chalk.bold.green('\n🎉 All checks passed! ZenSync configuration is correct.'));
}

run();
