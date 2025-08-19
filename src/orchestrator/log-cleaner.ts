import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getLogger } from '../common/logger';

/**
 * Manages log cleanup with lockfile-based coordination to prevent
 * concurrent cleanups and unbounded log growth.
 */
export class LogCleaner {
  private static readonly LOCKFILE = '.cleanup.lock';
  private static readonly CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  private static readonly MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
  private static readonly MAX_TOTAL_SIZE = 500_000_000; // 500MB

  private static logger = getLogger();

  /**
   * Opportunistically trigger cleanup if needed.
   * Never blocks execution - runs async and ignores failures.
   */
  static cleanupIfNeeded(sessionId: string): void {
    // Fire and forget - NEVER block execution
    this.tryCleanup(sessionId).catch(() => {
      // Silently ignore all cleanup errors
    });
  }

  /**
   * Attempt to acquire lock and perform cleanup.
   */
  private static async tryCleanup(sessionId: string): Promise<void> {
    const logsDir = this.getLogsDir();
    const lockPath = path.join(logsDir, this.LOCKFILE);

    try {
      // Ensure logs directory exists
      await fs.mkdir(logsDir, { recursive: true });

      // Check if lock exists and how old it is
      const stats = await fs.stat(lockPath);
      const age = Date.now() - stats.mtimeMs;

      if (age < this.CLEANUP_INTERVAL) {
        return; // Someone cleaned recently
      }

      // Lock is stale, remove it
      await fs.unlink(lockPath);
    } catch {
      // No lock file or can't read = proceed to try acquiring
    }

    try {
      // Try to acquire lock (atomic operation with exclusive write)
      await fs.writeFile(
        lockPath,
        JSON.stringify({
          pid: process.pid,
          session: sessionId,
          timestamp: new Date().toISOString(),
        }),
        { flag: 'wx' },
      );
    } catch {
      // Someone else got the lock, that's fine
      return;
    }

    // We have the lock, do cleanup async
    setTimeout(() => {
      this.performCleanup().finally(() => {
        // Remove lock when done (best effort)
        fs.unlink(lockPath).catch(() => {});
      });
    }, 0);
  }

  /**
   * Perform the actual cleanup of old log files.
   */
  private static async performCleanup(): Promise<void> {
    const sessionsDir = path.join(this.getLogsDir(), 'sessions');

    try {
      const files = await fs.readdir(sessionsDir);

      const now = Date.now();

      // Get file info
      const fileInfo = await Promise.all(
        files
          .filter((f) => f.endsWith('.jsonl'))
          .map(async (file) => {
            const filePath = path.join(sessionsDir, file);
            try {
              const stats = await fs.stat(filePath);
              return {
                path: filePath,
                name: file,
                size: stats.size,
                mtime: stats.mtimeMs,
              };
            } catch {
              return null; // File might have been deleted
            }
          }),
      );

      // Filter out nulls and sort by age (oldest first)
      const validFiles = fileInfo
        .filter((f): f is NonNullable<typeof f> => f !== null)
        .sort((a, b) => a.mtime - b.mtime);

      // Calculate total size
      let currentTotalSize = 0;
      for (const file of validFiles) {
        currentTotalSize += file.size;
      }

      // Delete old files OR files to get under size limit
      for (const file of validFiles) {
        const age = now - file.mtime;
        const shouldDeleteForAge = age > this.MAX_AGE;
        const shouldDeleteForSize = currentTotalSize > this.MAX_TOTAL_SIZE;

        if (shouldDeleteForAge || shouldDeleteForSize) {
          try {
            await fs.unlink(file.path);
            currentTotalSize -= file.size; // Update total after deletion
            this.logger.logDebug(`Cleaned up old log: ${file.name}`);
          } catch {
            // Ignore deletion errors
          }
        }
      }
    } catch (err) {
      // Ignore all errors - cleanup is best effort
      this.logger.logDebug(`Cleanup error (ignored): ${err}`);
    }
  }

  /**
   * Get the logs directory path.
   */
  private static getLogsDir(): string {
    return path.join(os.homedir(), '.claude', 'logs', 'cc-hooks');
  }

  /**
   * Get the sessions directory path.
   */
  static getSessionsDir(): string {
    return path.join(this.getLogsDir(), 'sessions');
  }
}
