import { Readable } from 'stream';
import { 
  HookDefinition, 
  ClaudeHookEvent, 
  HookExecutionResult,
  ResourceLimits
} from '../common/types';
import { ProcessManager } from './process-manager';
import { StreamLimiter } from './stream-limiter';
import { ResultMapper, MappedResult } from './result-mapper';
import { DEFAULT_RESOURCE_LIMITS } from '../common/constants';
import { getLogger } from '../common/logger';
import { HookExecutionError } from '../common/errors';

export interface ExecutionContext {
  event: ClaudeHookEvent;
  resourceLimits?: ResourceLimits;
}

export interface HookResult extends MappedResult {
  hook: HookDefinition;
  duration: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  truncated: boolean;
}

/**
 * Executes hooks with resource limits and timeout enforcement.
 */
export class HookExecutor {
  private processManager: ProcessManager;
  private resultMapper: ResultMapper;
  private logger = getLogger();

  constructor() {
    this.processManager = new ProcessManager();
    this.resultMapper = new ResultMapper();
  }

  /**
   * Execute a single hook with resource limits.
   */
  async execute(hook: HookDefinition, context: ExecutionContext): Promise<HookResult> {
    const startTime = Date.now();
    const processId = `${hook.name}-${startTime}`;
    
    const limits = context.resourceLimits || DEFAULT_RESOURCE_LIMITS;
    const timeout = hook.timeout || limits.timeoutMs;

    this.logger.log(`Executing hook '${hook.name}' with timeout ${timeout}ms`);

    let stdoutData = '';
    let stderrData = '';
    let truncated = false;
    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      // Spawn the process
      const child = this.processManager.spawn(processId, hook.command, {
        cwd: context.event.cwd,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Write event data to stdin
      const eventJson = JSON.stringify(context.event);
      child.stdin?.write(eventJson);
      child.stdin?.end();

      // Set up output limiters
      const stdoutLimiter = new StreamLimiter(
        limits.maxOutputBytes,
        () => {
          truncated = true;
          this.logger.log(`Hook '${hook.name}' stdout exceeded limit, killing process`);
          child.kill('SIGKILL');
        },
        'stdout'
      );

      const stderrLimiter = new StreamLimiter(
        limits.maxOutputBytes,
        () => {
          truncated = true;
          this.logger.log(`Hook '${hook.name}' stderr exceeded limit, killing process`);
          child.kill('SIGKILL');
        },
        'stderr'
      );

      // Pipe and collect output
      if (child.stdout) {
        child.stdout.pipe(stdoutLimiter);
        stdoutLimiter.on('data', (chunk: Buffer) => {
          stdoutData += chunk.toString();
        });
      }

      if (child.stderr) {
        child.stderr.pipe(stderrLimiter);
        stderrLimiter.on('data', (chunk: Buffer) => {
          stderrData += chunk.toString();
        });
      }

      // Set up timeout
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        this.logger.log(`Hook '${hook.name}' timed out after ${timeout}ms`);
        
        // Two-phase kill: SIGTERM first
        child.kill('SIGTERM');
        
        // SIGKILL after 2 seconds if still alive
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 2000);
      }, timeout);

      // Wait for process to exit
      const [exitCode, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
        child.on('exit', (code, sig) => {
          resolve([code, sig]);
        });
      });

      // Clear timeout if process finished naturally
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      const duration = Date.now() - startTime;

      // Create execution result
      const executionResult: HookExecutionResult = {
        success: exitCode === 0,
        stdout: stdoutData,
        stderr: stderrData,
        exitCode: exitCode || 0,
        truncated,
        timedOut
      };

      // Map the result
      const mappedResult = this.resultMapper.map(hook, executionResult);

      this.logger.log(`Hook '${hook.name}' completed in ${duration}ms with exit code ${exitCode}`);

      return {
        ...mappedResult,
        hook,
        duration,
        exitCode,
        signal,
        timedOut,
        truncated
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Clean up timeout
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      // Kill process if still running
      await this.processManager.kill(processId, 'SIGKILL');

      throw new HookExecutionError(
        hook.name,
        1,
        error instanceof Error ? error.message : String(error),
        false
      );
    }
  }

  /**
   * Execute multiple hooks in parallel.
   */
  async executeAll(hooks: HookDefinition[], context: ExecutionContext): Promise<HookResult[]> {
    this.logger.log(`Executing ${hooks.length} hooks in parallel`);
    
    const promises = hooks.map(hook => 
      this.execute(hook, context).catch(error => {
        // Convert errors to results for partial failure handling
        const duration = 0;
        return {
          hook,
          flowControl: 'non-blocking-error' as const,
          message: error instanceof Error ? error.message : String(error),
          rawOutput: '',
          duration,
          exitCode: 1,
          signal: null,
          timedOut: false,
          truncated: false
        };
      })
    );

    return Promise.all(promises);
  }

  /**
   * Shutdown the executor and clean up resources.
   */
  async shutdown(): Promise<void> {
    this.logger.log('Shutting down HookExecutor');
    await this.processManager.cleanup();
  }
}