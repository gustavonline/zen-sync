import inquirer from 'inquirer';
import chalk from 'chalk';
import config from './config.js';

export async function setup() {
    console.log(chalk.bold.blue('ZenSync Setup Wizard'));

    const answers = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'isCorrectDir',
            message: `Is this your ZenSync repository?\n  ${process.cwd()}`,
            default: true
        }
    ]);

    if (!answers.isCorrectDir) {
        console.log(chalk.red('Please navigate to your ZenSync directory and run setup again.'));
        process.exit(0);
    }

    config.set('repoPath', process.cwd());
    console.log(chalk.green('✅ Configuration saved!'));
    console.log(chalk.white('You can now run:'), chalk.cyan('zensync watch'));
}
