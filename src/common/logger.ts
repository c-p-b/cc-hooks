import fs from 'fs';
import path from 'path';
import { LogLevel, LoggingConfig, ClaudeHookEvent, HookDefinition } from './types';
import { DEFAULT_LOG_FILE_PATH, MAX_LOG_SIZE_BYTES, NO_COLOR } from './constants';
import chalk from 'chalk';

export class Logger {
  private level: LogLevel;
  private logPath: string;
  private useColor: boolean;

  constructor(config?: LoggingConfig) {
    this.level = config?.level || 'off';
    this.logPath = config?.path || DEFAULT_LOG_FILE_PATH;
    this.useColor = !NO_COLOR;
  }

  /**
   * Log an event received from Claude
   */
  logEvent(event: ClaudeHookEvent): void {
    if (this.level === 'off') return;
    
    const message = `Event received: ${event.hook_event_name}`;
    this.log('INFO', message);
    
    if (this.level === 'verbose') {
      this.log('DEBUG', `Full event data: ${JSON.stringify(event, null, 2)}`);
    }
  }

  /**
   * Log hook execution start
   */
  logHookStart(hook: HookDefinition): void {
    if (this.level === 'off') return;
    
    const message = `Executing hook: ${hook.name}`;
    this.log('INFO', message);
    
    if (this.level === 'verbose') {
      this.log('DEBUG', `Hook config: ${JSON.stringify(hook, null, 2)}`);
    }
  }

  /**
   * Log hook execution result
   */
  logHookResult(hook: HookDefinition, result: { success: boolean; exitCode?: number; error?: Error }): void {
    if (this.level === 'off') return;
    
    if (result.success) {
      this.log('INFO', `Hook completed: ${hook.name}`);
    } else {
      const exitInfo = result.exitCode !== undefined ? ` (exit: ${result.exitCode})` : '';
      this.log('ERROR', `Hook failed: ${hook.name}${exitInfo}`);
      
      if (result.error && this.level === 'verbose') {
        this.log('DEBUG', `Error details: ${result.error.stack || result.error.message}`);
      }
    }
  }

  /**
   * Log an error
   */
  logError(error: Error): void {
    if (this.level === 'off' || this.level === 'errors' || this.level === 'verbose') {
      this.log('ERROR', error.message);
      
      if (this.level === 'verbose' && error.stack) {
        this.log('DEBUG', `Stack trace: ${error.stack}`);
      }
    }
  }

  /**
   * Log an info message
   */
  logInfo(message: string): void {
    if (this.level === 'verbose') {
      this.log('INFO', message);
    }
  }

  /**
   * Log a debug message
   */
  logDebug(message: string): void {
    if (this.level === 'verbose') {
      this.log('DEBUG', message);
    }
  }

  /**
   * Write to console (respecting color settings)
   */
  console(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
    const formatted = this.formatConsoleMessage(level, message);
    
    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'debug':
        if (this.level === 'verbose') {
          console.debug(formatted);
        }
        break;
      default:
        console.log(formatted);
    }
  }

  /**
   * Format message for console output
   */
  private formatConsoleMessage(level: string, message: string): string {
    if (!this.useColor) {
      return message;
    }

    switch (level) {
      case 'error':
        return chalk.red(message);
      case 'warn':
        return chalk.yellow(message);
      case 'info':
        return chalk.blue(message);
      case 'debug':
        return chalk.gray(message);
      default:
        return message;
    }
  }

  /**
   * Core logging function
   */
  private log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}\n`;
    
    try {
      // Ensure log directory exists
      const logDir = path.dirname(this.logPath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // Check if rotation is needed
      this.rotateIfNeeded();

      // Append to log file
      fs.appendFileSync(this.logPath, logLine);
    } catch (error) {
      // Silently fail logging to avoid disrupting the main flow
      if (this.level === 'verbose') {
        console.error(`Failed to write to log: ${error}`);
      }
    }
  }

  /**
   * Rotate log file if it exceeds max size
   */
  private rotateIfNeeded(): void {
    try {
      const stats = fs.statSync(this.logPath);
      if (stats.size > MAX_LOG_SIZE_BYTES) {
        const rotatedPath = `${this.logPath}.${Date.now()}`;
        fs.renameSync(this.logPath, rotatedPath);
        
        // Keep only the last 3 rotated logs
        this.cleanOldLogs();
      }
    } catch {
      // File doesn't exist yet, which is fine
    }
  }

  /**
   * Clean old rotated log files
   */
  private cleanOldLogs(): void {
    try {
      const logDir = path.dirname(this.logPath);
      const logBase = path.basename(this.logPath);
      const files = fs.readdirSync(logDir);
      
      const rotatedLogs = files
        .filter(f => f.startsWith(`${logBase}.`))
        .map(f => ({
          name: f,
          path: path.join(logDir, f),
          time: parseInt(f.split('.').pop() || '0', 10)
        }))
        .sort((a, b) => b.time - a.time);
      
      // Keep only the 3 most recent
      rotatedLogs.slice(3).forEach(log => {
        fs.unlinkSync(log.path);
      });
    } catch {
      // Best effort cleanup
    }
  }
}

// Singleton instance for global logging
let globalLogger: Logger | null = null;

/**
 * Initialize the global logger
 */
export function initializeLogger(config?: LoggingConfig): void {
  globalLogger = new Logger(config);
}

/**
 * Get the global logger instance
 */
export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger();
  }
  return globalLogger;
}