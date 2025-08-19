import { spawn } from 'child_process';
import * as path from 'path';

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the compiled cc-hooks binary exactly as npm would when globally installed.
 * This tests the REAL artifact that users will run.
 */
export function runBinary(
  args: string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    timeout?: number;
  }
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Path to the actual compiled binary that npm will install
    const binPath = path.resolve(__dirname, '../../dist/cli.js');
    
    // Run it exactly as npm does - with node
    const proc = spawn('node', [binPath, ...args], {
      cwd: options?.cwd || process.cwd(),
      env: options?.env || process.env,
    });
    
    let stdout = '';
    let stderr = '';
    let finished = false;
    
    // Timeout to prevent hanging tests
    const timeout = setTimeout(() => {
      if (!finished) {
        proc.kill('SIGKILL');
        reject(new Error(`Process timed out after ${options?.timeout || 2000}ms`));
      }
    }, options?.timeout || 2000);
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('error', (err) => {
      finished = true;
      clearTimeout(timeout);
      reject(err);
    });
    
    proc.on('close', (exitCode) => {
      finished = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: exitCode || 0 });
    });
    
    // Send input if provided
    if (options?.input) {
      proc.stdin.write(options.input);
      proc.stdin.end();
    }
  });
}

/**
 * Run cc-hooks with event data on stdin, simulating Claude's invocation
 */
export async function runHookBinary(
  eventData: any,
  options?: {
    configPath?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
  }
): Promise<RunResult> {
  const args = ['run'];
  if (options?.configPath) {
    args.push('--config', options.configPath);
  }
  
  return runBinary(args, {
    cwd: options?.cwd,
    env: options?.env,
    input: JSON.stringify(eventData),
    timeout: options?.timeout
  });
}