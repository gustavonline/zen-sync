import fs from 'fs';
import path from 'path';
import envPaths from 'env-paths';
import chalk from 'chalk';

const paths = envPaths('zensync');
// Ensure log directory exists
if (!fs.existsSync(paths.log)) {
    fs.mkdirSync(paths.log, { recursive: true });
}

const LOG_FILE = path.join(paths.log, 'zensync.log');

export const getLogPath = () => LOG_FILE;

export const log = (message, type = 'info') => {
    const timestamp = new Date().toISOString();
    const cleanMessage = message.replace(/\u001b\[\d+m/g, ''); // Remove ANSI colors for file
    const logLine = `[${timestamp}] [${type.toUpperCase()}] ${cleanMessage}\n`;
    
    // Append to file
    try {
        fs.appendFileSync(LOG_FILE, logLine);
    } catch (e) {
        console.error('Failed to write to log file:', e);
    }

    // Output to console if we are in foreground (optional, but handled by CLI usually)
    // Here we return the styled message for the caller to print if they want
    const style = {
        info: chalk.white,
        success: chalk.green,
        warning: chalk.yellow,
        error: chalk.red
    }[type] || chalk.white;
    
    const styledMessage = style(message);
    
    // Always log to console as well (for foreground usage)
    console.log(styledMessage);

    return styledMessage;
};

export const readLogs = (lines = 20) => {
    if (!fs.existsSync(LOG_FILE)) return [];
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    return content.trim().split('\n').slice(-lines);
};

export const clearLogs = () => {
    if (fs.existsSync(LOG_FILE)) {
        fs.writeFileSync(LOG_FILE, '');
    }
};
