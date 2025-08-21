import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import { LogEntry } from '../common/types';
import { CCHooksError } from '../common/errors';

export interface LogsOptions {
  follow?: boolean; // -f, tail logs
  session?: boolean; // Show current session only
  failed?: boolean; // Show failed hooks only
  limit?: number; // Number of entries to show
  verbose?: boolean; // Show full output
  details?: boolean; // Show detailed info including output snippets
  stats?: boolean; // Show summary statistics
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

    // Show statistics if requested
    if (options.stats) {
      this.displayStats(entries);
      console.log(''); // Blank line separator
    }

    // Display entries
    this.displayEntries(entries, options);
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
      this.displayEntries(toShow, options);
      console.log(chalk.gray('---'));
    }

    // Watch for new entries
    this.watchFile(filePath, hookName || undefined, options);
  }

  private watchFile(
    filePath: string,
    hookName: string | undefined,
    options: LogsOptions = {},
  ): void {
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
                this.displayEntry(entry, options);
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
    options: LogsOptions,
  ): Promise<LogEntry[]> {
    const entries: LogEntry[] = [];
    const logFiles = await this.getLogFiles();

    // If session filter, only read current session file
    const filesToRead = options.session ? logFiles.slice(-1) : logFiles;

    for (const file of filesToRead) {
      const filePath = path.join(this.logDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

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
    options: LogsOptions = {},
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

    const files = fs
      .readdirSync(this.logDir)
      .filter((f) => f.startsWith('session-') && f.endsWith('.jsonl'))
      .sort();

    return files;
  }

  private displayEntries(entries: LogEntry[], options: LogsOptions): void {
    for (const entry of entries) {
      this.displayEntry(entry, options);
    }
  }

  private displayEntry(entry: LogEntry, options: LogsOptions): void {
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

    if (entry.signal) {
      line += chalk.red(` [SIGNAL: ${entry.signal}]`);
    }

    console.log(line);

    // Show command if verbose or details mode
    if ((options.verbose || options.details) && entry.command) {
      console.log(chalk.gray(`  Command: ${entry.command.join(' ')}`));
    }

    // Show tool name if available
    if ((options.verbose || options.details) && entry.tool_name) {
      console.log(chalk.gray(`  Tool: ${entry.tool_name}`));
    }

    // Show exit code in verbose mode
    if (options.verbose && entry.exit_code !== null) {
      console.log(chalk.gray(`  Exit code: ${entry.exit_code}`));
    }

    // Show message if available (usually error messages)
    if ((options.verbose || options.details) && entry.message) {
      console.log(chalk.yellow(`  Message: ${entry.message}`));
    }

    // Show output snippets in details mode
    if (options.details) {
      if (entry.stdout_snippet) {
        console.log(chalk.green('  Output:'));
        entry.stdout_snippet.split('\n').forEach((line) => {
          console.log(chalk.gray(`    ${line}`));
        });
      }
      if (entry.stderr_snippet) {
        console.log(chalk.red('  Errors:'));
        entry.stderr_snippet.split('\n').forEach((line) => {
          console.log(chalk.gray(`    ${line}`));
        });
      }
    }

    // Show session in verbose mode
    if (options.verbose) {
      console.log(chalk.gray(`  Session: ${entry.session_id}`));
    }
  }

  private displayStats(entries: LogEntry[]): void {
    const totalHooks = entries.length;
    const successCount = entries.filter((e) => e.flow_control === 'success').length;
    const nonBlockingErrors = entries.filter((e) => e.flow_control === 'non-blocking-error').length;
    const blockingErrors = entries.filter((e) => e.flow_control === 'blocking-error').length;
    const timeouts = entries.filter((e) => e.timed_out).length;

    const avgDuration = entries.reduce((sum, e) => sum + e.duration, 0) / entries.length;
    const maxDuration = Math.max(...entries.map((e) => e.duration));

    // Group by hook name
    const hookStats = new Map<string, { count: number; failures: number; avgDuration: number }>();
    entries.forEach((entry) => {
      const stats = hookStats.get(entry.hook) || { count: 0, failures: 0, avgDuration: 0 };
      stats.count++;
      if (entry.flow_control !== 'success') stats.failures++;
      stats.avgDuration = (stats.avgDuration * (stats.count - 1) + entry.duration) / stats.count;
      hookStats.set(entry.hook, stats);
    });

    console.log(chalk.bold('=== Execution Statistics ==='));
    console.log(`Total executions: ${totalHooks}`);
    console.log(
      `  ${chalk.green(`✓ Success: ${successCount}`)} (${((successCount / totalHooks) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  ${chalk.yellow(`⚠ Non-blocking errors: ${nonBlockingErrors}`)} (${((nonBlockingErrors / totalHooks) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  ${chalk.red(`✗ Blocking errors: ${blockingErrors}`)} (${((blockingErrors / totalHooks) * 100).toFixed(1)}%)`,
    );
    if (timeouts > 0) {
      console.log(`  ${chalk.red(`⏱ Timeouts: ${timeouts}`)}`);
    }

    console.log(`\nPerformance:`);
    console.log(`  Average duration: ${avgDuration.toFixed(0)}ms`);
    console.log(`  Max duration: ${maxDuration}ms`);

    if (hookStats.size > 1) {
      console.log(`\nPer-hook breakdown:`);
      Array.from(hookStats.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .forEach(([name, stats]) => {
          const failRate = ((stats.failures / stats.count) * 100).toFixed(0);
          const statusIcon =
            stats.failures === 0 ? '✓' : stats.failures === stats.count ? '✗' : '⚠';
          const statusColor =
            stats.failures === 0 ? 'green' : stats.failures === stats.count ? 'red' : 'yellow';
          console.log(
            chalk[statusColor](
              `  ${statusIcon} ${name}: ${stats.count} runs, ${failRate}% fail rate, ${stats.avgDuration.toFixed(0)}ms avg`,
            ),
          );
        });
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
