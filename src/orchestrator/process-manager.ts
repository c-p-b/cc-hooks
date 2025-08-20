import { ChildProcess, spawn, SpawnOptions } from 'child_process';
import { getLogger } from '../common/logger';
import { IS_WINDOWS } from '../common/constants';

interface ProcessEntry {
  process: ChildProcess;
  command: string[];
  startTime: number;
}

/**
 * Manages child process lifecycle and ensures clean shutdown.
 * Prevents zombie processes and resource leaks.
 */
export class ProcessManager {
  private processes = new Map<string, ProcessEntry>();
  private logger = getLogger();
  private shutdownInitiated = false;

  constructor() {
    // Register cleanup handlers for all exit scenarios
    process.once('SIGTERM', () => this.handleShutdown('SIGTERM'));
    process.once('SIGINT', () => this.handleShutdown('SIGINT'));
    process.once('exit', () => this.cleanup());
    process.once('uncaughtException', (err) => {
      this.logger.logError(err);
      this.cleanup();
      process.exit(1);
    });
  }

  /**
   * Spawn a new managed process.
   */
  spawn(id: string, command: string[], options: SpawnOptions = {}): ChildProcess {
    if (this.shutdownInitiated) {
      throw new Error('Cannot spawn new processes during shutdown');
    }

    if (command.length === 0) {
      throw new Error('Command array cannot be empty');
    }

    // Use process groups on Unix for clean kill of child trees
    const spawnOptions: SpawnOptions = {
      ...options,
      detached: !IS_WINDOWS, // Create new process group on Unix
    };

    const child = spawn(command[0]!, command.slice(1), spawnOptions);

    this.processes.set(id, {
      process: child,
      command,
      startTime: Date.now(),
    });

    // Clean up when process closes (ensures stdio streams are closed)
    child.once('close', () => {
      this.processes.delete(id);
      this.logger.log(`Process ${id} exited`);
    });

    child.once('error', (err) => {
      this.logger.logError(new Error(`Process ${id} error: ${err.message}`));
      this.processes.delete(id);
    });

    return child;
  }

  /**
   * Kill a specific process.
   */
  async kill(id: string, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    const entry = this.processes.get(id);
    if (!entry) return;

    const { process: proc } = entry;

    if (IS_WINDOWS) {
      proc.kill(signal);
    } else {
      // Kill entire process group on Unix
      try {
        process.kill(-proc.pid!, signal);
      } catch (err) {
        // Process might already be dead
        this.logger.log(`Failed to kill process group ${id}: ${err}`);
      }
    }
  }

  /**
   * Get active process count.
   */
  getActiveCount(): number {
    return this.processes.size;
  }

  /**
   * Handle shutdown signals.
   */
  private async handleShutdown(signal: string): Promise<void> {
    if (this.shutdownInitiated) return;

    this.shutdownInitiated = true;
    this.logger.log(`Received ${signal}, initiating graceful shutdown`);

    await this.cleanup();
    process.exit(0);
  }

  /**
   * Clean up all processes.
   */
  async cleanup(): Promise<void> {
    if (this.processes.size === 0) return;

    this.logger.log(`Cleaning up ${this.processes.size} active processes`);

    // Phase 1: Send SIGTERM for graceful shutdown
    for (const [, entry] of this.processes) {
      const { process: proc } = entry;

      if (IS_WINDOWS) {
        proc.kill('SIGTERM');
      } else {
        // Kill entire process group
        try {
          process.kill(-proc.pid!, 'SIGTERM');
        } catch {
          // Process might already be dead
        }
      }
    }

    // Give processes 2 seconds to die gracefully
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Phase 2: Force kill any survivors
    for (const [id, entry] of this.processes) {
      const { process: proc } = entry;

      if (!proc.killed) {
        this.logger.log(`Force killing process ${id}`);

        if (IS_WINDOWS) {
          // Use taskkill to kill process tree on Windows
          try {
            const killer = spawn('taskkill', ['/F', '/T', '/PID', proc.pid!.toString()], {
              stdio: 'ignore',
            });
            killer.unref();
          } catch (err) {
            this.logger.logError(new Error(`Failed to force kill ${id}: ${err}`));
          }
        } else {
          // SIGKILL the process group
          try {
            process.kill(-proc.pid!, 'SIGKILL');
          } catch {
            // Process might already be dead
          }
        }
      }
    }

    // Clear the map
    this.processes.clear();
  }

  /**
   * Get process information for debugging.
   */
  getProcessInfo(): Array<{ id: string; command: string[]; uptime: number }> {
    const info: Array<{ id: string; command: string[]; uptime: number }> = [];

    for (const [id, entry] of this.processes) {
      info.push({
        id,
        command: entry.command,
        uptime: Date.now() - entry.startTime,
      });
    }

    return info;
  }
}
