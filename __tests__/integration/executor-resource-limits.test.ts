import { HookExecutor, ExecutionContext } from '../../src/orchestrator/executor';
import { TextHook } from '../../src/common/types';

describe('HookExecutor Resource Limits', () => {
  let executor: HookExecutor;

  beforeEach(() => {
    executor = new HookExecutor();
  });

  afterEach(async () => {
    await executor.shutdown();
  });

  describe('Timeout Enforcement', () => {
    it('should kill a hook that exceeds timeout', async () => {
      const hook: TextHook = {
        name: 'slow-hook',
        command: ['sleep', '10'],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
        message: 'Hook timed out',
        timeout: 100, // 100ms timeout
      };

      const context: ExecutionContext = {
        event: {
          hook_event_name: 'Stop',
          session_id: 'test-timeout',
          transcript_path: '',
          cwd: process.cwd(),
        },
      };

      const result = await executor.execute(hook, context);

      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
      expect(result.duration).toBeGreaterThanOrEqual(100);
      expect(result.duration).toBeLessThan(500); // Should not wait full 10 seconds
    });

    it('should complete normally within timeout', async () => {
      const hook: TextHook = {
        name: 'fast-hook',
        command: ['echo', 'hello'],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
        message: 'Success',
        timeout: 5000,
      };

      const context: ExecutionContext = {
        event: {
          hook_event_name: 'Stop',
          session_id: 'test-normal',
          transcript_path: '',
          cwd: process.cwd(),
        },
      };

      const result = await executor.execute(hook, context);

      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);
      expect(result.rawOutput.trim()).toBe('hello');
    });
  });

  describe('Output Limiting', () => {
    it('should truncate output exceeding limit', async () => {
      // Create a command that generates lots of output
      const hook: TextHook = {
        name: 'chatty-hook',
        command: [
          'sh',
          '-c',
          'for i in $(seq 1 100000); do echo "Line $i: This is a very long line of output that will eventually exceed our limit"; done',
        ],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
        message: 'Too much output',
      };

      const context: ExecutionContext = {
        event: {
          hook_event_name: 'Stop',
          session_id: 'test-output-limit',
          transcript_path: '',
          cwd: process.cwd(),
        },
        resourceLimits: {
          maxOutputBytes: 1024, // 1KB limit for testing
          timeoutMs: 5000,
        },
      };

      const result = await executor.execute(hook, context);

      expect(result.truncated).toBe(true);
      expect(result.rawOutput.length).toBeLessThanOrEqual(1024);
    });

    it('should handle output within limits', async () => {
      const hook: TextHook = {
        name: 'normal-output',
        command: ['echo', 'Small output'],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
        message: 'Success',
      };

      const context: ExecutionContext = {
        event: {
          hook_event_name: 'Stop',
          session_id: 'test-normal-output',
          transcript_path: '',
          cwd: process.cwd(),
        },
        resourceLimits: {
          maxOutputBytes: 1048576, // 1MB
          timeoutMs: 30000,
        },
      };

      const result = await executor.execute(hook, context);

      expect(result.truncated).toBe(false);
      expect(result.rawOutput.trim()).toBe('Small output');
    });
  });

  describe('Parallel Execution', () => {
    it('should execute multiple hooks in parallel', async () => {
      const hooks: TextHook[] = [
        {
          name: 'hook1',
          command: ['sh', '-c', 'sleep 0.1 && echo "Hook 1"'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
          message: 'Hook 1',
        },
        {
          name: 'hook2',
          command: ['sh', '-c', 'sleep 0.1 && echo "Hook 2"'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
          message: 'Hook 2',
        },
        {
          name: 'hook3',
          command: ['sh', '-c', 'sleep 0.1 && echo "Hook 3"'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
          message: 'Hook 3',
        },
      ];

      const context: ExecutionContext = {
        event: {
          hook_event_name: 'Stop',
          session_id: 'test-parallel',
          transcript_path: '',
          cwd: process.cwd(),
        },
      };

      const startTime = Date.now();
      const results = await executor.executeAll(hooks, context);
      const totalTime = Date.now() - startTime;

      // If run sequentially, would take 300ms minimum
      // In parallel, should complete in ~100ms
      expect(totalTime).toBeLessThan(250);
      expect(results).toHaveLength(3);
      expect(results[0]?.rawOutput.trim()).toBe('Hook 1');
      expect(results[1]?.rawOutput.trim()).toBe('Hook 2');
      expect(results[2]?.rawOutput.trim()).toBe('Hook 3');
    });

    it('should handle partial failures in parallel execution', async () => {
      const hooks: TextHook[] = [
        {
          name: 'success-hook',
          command: ['echo', 'Success'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
          message: 'Success',
        },
        {
          name: 'failure-hook',
          command: ['sh', '-c', 'exit 1'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success', '1': 'blocking-error', default: 'non-blocking-error' },
          message: 'Failed',
        },
      ];

      const context: ExecutionContext = {
        event: {
          hook_event_name: 'Stop',
          session_id: 'test-partial-failure',
          transcript_path: '',
          cwd: process.cwd(),
        },
      };

      const results = await executor.executeAll(hooks, context);

      expect(results).toHaveLength(2);
      expect(results[0]?.flowControl).toBe('success');
      expect(results[1]?.flowControl).toBe('blocking-error');
    });
  });

  describe('Exit Code Mapping', () => {
    it('should map exit codes correctly for text hooks', async () => {
      const hook: TextHook = {
        name: 'exit-code-test',
        command: ['sh', '-c', 'exit 2'],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: {
          '0': 'success',
          '1': 'non-blocking-error',
          '2': 'blocking-error',
          default: 'non-blocking-error',
        },
        message: 'Exit code test',
      };

      const context: ExecutionContext = {
        event: {
          hook_event_name: 'Stop',
          session_id: 'test-exit-code',
          transcript_path: '',
          cwd: process.cwd(),
        },
      };

      const result = await executor.execute(hook, context);

      expect(result.exitCode).toBe(2);
      expect(result.flowControl).toBe('blocking-error');
    });

    it('should use default mapping for unmapped exit codes', async () => {
      const hook: TextHook = {
        name: 'default-mapping',
        command: ['sh', '-c', 'exit 99'],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: {
          '0': 'success',
          default: 'non-blocking-error',
        },
        message: 'Default mapping test',
      };

      const context: ExecutionContext = {
        event: {
          hook_event_name: 'Stop',
          session_id: 'test-default-mapping',
          transcript_path: '',
          cwd: process.cwd(),
        },
      };

      const result = await executor.execute(hook, context);

      expect(result.exitCode).toBe(99);
      expect(result.flowControl).toBe('non-blocking-error');
    });
  });

  describe('Environment Variables', () => {
    it('should set CLAUDE_PROJECT_DIR environment variable', async () => {
      const hook: TextHook = {
        name: 'env-test',
        command: ['sh', '-c', 'echo "PROJECT_DIR=$CLAUDE_PROJECT_DIR"'],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
        message: 'Env test',
      };

      const context: ExecutionContext = {
        event: {
          hook_event_name: 'Stop',
          session_id: 'test-env',
          transcript_path: '',
          cwd: process.cwd(),
        },
      };

      const result = await executor.execute(hook, context);

      expect(result.rawOutput).toContain('PROJECT_DIR=');
      expect(result.exitCode).toBe(0);
    });
  });
});
