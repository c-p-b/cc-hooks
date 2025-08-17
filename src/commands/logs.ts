import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import { LogEntry } from '../common/types';
import { CCHooksError } from '../common/errors';

export interface LogsOptions {
  follow?: boolean;       // -f, tail logs
  session?: boolean;      // Show current session only
  failed?: boolean;       // Show failed hooks only
  limit?: number;         // Number of entries to show
  verbose?: boolean;      // Show full output
}

export class LogsCommand {
  private logDir: string;

  constructor() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    this.logDir = path.join(homeDir, '.claude', 'logs', 'cc-hooks', 'sessions');
  }

  async execute(hookName: string | undefined, options: LogsOptions = {}): Promise<void> {
    try {
      if (!fs.existsSync(this.logDir)) {
        console.log(chalk.yellow('No logs found. Hooks may not have been executed yet.'));
        return;
      }

      if (options.follow) {
        await this.tailLogs(hookName, options);
      } else {
        await this.showLogs(hookName, options);
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  private async showLogs(hookName: string | undefined, options: LogsOptions): Promise<void> {
    const entries = await this.readLogEntries(hookName, options);
    
    if (entries.length === 0) {
      console.log(chalk.yellow('No matching log entries found.'));
      return;
    }

    // Display entries
    this.displayEntries(entries, options.verbose);
  }

  private async tailLogs(hookName: string | undefined, options: LogsOptions): Promise<void> {
    console.log(chalk.cyan('Tailing logs... (Ctrl+C to stop)'));
    
    // Get the most recent log file
    const logFiles = await this.getLogFiles();
    if (logFiles.length === 0) {
      console.log(chalk.yellow('No log files found.'));
      return;
    }

    const latestFile = logFiles[logFiles.length - 1];
    if (!latestFile) {
      console.log(chalk.yellow('No log files found.'));
      return;
    }
    const filePath = path.join(this.logDir, latestFile);

    // Create a readline interface for the file
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });

    // Process existing lines
    const existingEntries: LogEntry[] = [];
    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line) as LogEntry;
          if (this.matchesFilter(entry, hookName, options)) {
            existingEntries.push(entry);
          }
        } catch {
          // Skip malformed lines
        }
      }
    }

    // Display existing entries
    if (existingEntries.length > 0) {
      const toShow = existingEntries.slice(-20); // Show last 20
      this.displayEntries(toShow, options.verbose);
      console.log(chalk.gray('---'));
    }

    // Watch for new entries
    this.watchFile(filePath, hookName || undefined, options);
  }

  private watchFile(filePath: string, hookName: string | undefined, options: LogsOptions = {}): void {
    let position = fs.statSync(filePath).size;

    fs.watchFile(filePath, { interval: 100 }, () => {
      const newPosition = fs.statSync(filePath).size;
      if (newPosition > position) {
        const stream = fs.createReadStream(filePath, {
          start: position,
          end: newPosition,
        });

        const rl = readline.createInterface({
          input: stream,
          crlfDelay: Infinity,
        });

        rl.on('line', (line) => {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line) as LogEntry;
              if (this.matchesFilter(entry, hookName, options)) {
                this.displayEntry(entry, options.verbose);
              }
            } catch {
              // Skip malformed lines
            }
          }
        });

        position = newPosition;
      }
    });
  }

  private async readLogEntries(
    hookName: string | undefined,
    options: LogsOptions
  ): Promise<LogEntry[]> {
    const entries: LogEntry[] = [];
    const logFiles = await this.getLogFiles();
    
    // If session filter, only read current session file
    const filesToRead = options.session 
      ? logFiles.slice(-1) 
      : logFiles;

    for (const file of filesToRead) {
      const filePath = path.join(this.logDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as LogEntry;
          if (this.matchesFilter(entry, hookName, options)) {
            entries.push(entry);
          }
        } catch {
          // Skip malformed lines
        }
      }
    }

    // Sort by timestamp and apply limit
    entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    
    const limit = options.limit || 20;
    return entries.slice(-limit);
  }

  private matchesFilter(
    entry: LogEntry,
    hookName: string | undefined,
    options: LogsOptions = {}
  ): boolean {
    // Filter by hook name
    if (hookName && entry.hook !== hookName) {
      return false;
    }

    // Filter by failed status
    if (options.failed && entry.flow_control === 'success') {
      return false;
    }

    return true;
  }

  private async getLogFiles(): Promise<string[]> {
    if (!fs.existsSync(this.logDir)) {
      return [];
    }

    const files = fs.readdirSync(this.logDir)
      .filter(f => f.startsWith('session-') && f.endsWith('.jsonl'))
      .sort();

    return files;
  }

  private displayEntries(entries: LogEntry[], verbose?: boolean): void {
    for (const entry of entries) {
      this.displayEntry(entry, verbose);
    }
  }

  private displayEntry(entry: LogEntry, verbose?: boolean): void {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const statusColor = this.getStatusColor(entry.flow_control);
    const status = chalk[statusColor](entry.flow_control.toUpperCase());
    
    const hookName = chalk.cyan(entry.hook);
    const event = chalk.gray(entry.event);
    const duration = chalk.gray(`${entry.duration}ms`);

    let line = `[${timestamp}] ${status} ${hookName} (${event}) ${duration}`;
    
    if (entry.timed_out) {
      line += chalk.yellow(' [TIMEOUT]');
    }
    
    if (entry.truncated) {
      line += chalk.yellow(' [TRUNCATED]');
    }

    console.log(line);

    if (verbose) {
      if (entry.exit_code !== null) {
        console.log(chalk.gray(`  Exit code: ${entry.exit_code}`));
      }
      console.log(chalk.gray(`  Session: ${entry.session_id}`));
    }
  }

  private getStatusColor(flowControl: string): 'green' | 'yellow' | 'red' {
    switch (flowControl) {
      case 'success':
        return 'green';
      case 'non-blocking-error':
        return 'yellow';
      case 'blocking-error':
        return 'red';
      default:
        return 'yellow';
    }
  }

  private handleError(error: unknown): void {
    if (error instanceof CCHooksError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else if (error instanceof Error) {
      console.error(chalk.red(`Unexpected error: ${error.message}`));
      if (process.env.CC_HOOKS_DEBUG) {
        console.error(chalk.gray(error.stack));
      }
    } else {
      console.error(chalk.red('An unknown error occurred'));
    }
    process.exit(1);
  }
}