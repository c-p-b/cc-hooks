/**
 * Core Features Integration Test
 *
 * This test demonstrates that all core features of cc-hooks work correctly:
 * 1. Full workflow: init -> install -> execute -> uninit
 * 2. Resource limits (timeout and output)
 * 3. Exit code mapping and flow control
 * 4. Parallel execution
 * 5. Event filtering and matching
 */

import { InitCommand } from '../../src/commands/init';
import { UninitCommand } from '../../src/commands/uninit';
import { InstallCommand } from '../../src/commands/install';
import { RunCommand } from '../../src/commands/run';
import { HookExecutor, ExecutionContext } from '../../src/orchestrator/executor';
import { TextHook, StructuredHook } from '../../src/common/types';
import {
  mockProcessExit,
  expectProcessExit,
  executeWithExitCapture,
} from '../helpers/process-exit-mock';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Core Features Integration Tests', () => {
  let testDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;

    // Create isolated test environment
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hooks-core-test-'));
    process.env.HOME = testDir;

    // Create .claude directory
    fs.mkdirSync(path.join(testDir, '.claude'), { recursive: true });
  });

  afterEach(() => {
    // Restore environment
    if (originalHome) process.env.HOME = originalHome;

    // Clean up
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('1. Full Workflow Test', () => {
    it('should complete full lifecycle: init -> install -> run -> uninit', async () => {
      // Step 1: Initialize cc-hooks
      const init = new InitCommand(testDir);
      await init.execute({ force: true });

      // Verify settings.json was created with orchestrator
      const settingsPath = path.join(testDir, '.claude', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe('cc-hooks run');

      // Step 2: Install a hook
      const hookDef = {
        name: 'test-workflow-hook',
        command: ['echo', 'Workflow test successful'],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
        message: 'Test hook executed',
      };

      const hookPath = path.join(testDir, 'test-hook.json');
      fs.writeFileSync(hookPath, JSON.stringify(hookDef));
      const install = new InstallCommand(testDir);
      await install.execute(hookPath);

      // Verify hook was installed
      const configPath = path.join(testDir, '.claude', 'cc-hooks.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.hooks).toHaveLength(1);
      expect(config.hooks[0].name).toBe('test-workflow-hook');

      // Step 3: Execute the hook via RunCommand
      const run = new RunCommand(testDir);
      const mockEvent = {
        hook_event_name: 'Stop',
        session_id: 'test-workflow',
        transcript_path: '',
        cwd: testDir,
      };

      // Mock stdin to provide event data
      const originalStdin = process.stdin;
      const mockStdin = require('stream').Readable.from([JSON.stringify(mockEvent)]);
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        configurable: true,
      });

      // Capture output
      const consoleLog = jest.spyOn(console, 'log').mockImplementation();
      const exitMock = mockProcessExit();

      // Execute and expect exit
      const exitCode = await expectProcessExit(async () => {
        await run.execute();
      });

      // Verify hook executed successfully
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Workflow test successful'));
      expect(exitCode).toBe(0); // Success exit

      // Restore stdin
      Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
      consoleLog.mockRestore();
      exitMock.restore();

      // Step 4: Uninitialize
      const uninit = new UninitCommand(testDir);
      await uninit.execute();

      // Verify cleanup
      expect(fs.existsSync(configPath)).toBe(false);
      const finalSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(finalSettings.hooks).toBeUndefined();
    });
  });

  describe('2. Resource Limits Test', () => {
    let executor: HookExecutor;

    beforeEach(() => {
      executor = new HookExecutor();
    });

    afterEach(async () => {
      await executor.shutdown();
    });

    it('should enforce timeout limits', async () => {
      const slowHook: TextHook = {
        name: 'timeout-test',
        command: ['sh', '-c', 'sleep 5'],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
        message: 'Timeout test',
        timeout: 100, // 100ms timeout
      };

      const context: ExecutionContext = {
        event: {
          hook_event_name: 'Stop',
          session_id: 'timeout-test',
          transcript_path: '',
          cwd: testDir,
        },
      };

      const startTime = Date.now();
      const result = await executor.execute(slowHook, context);
      const duration = Date.now() - startTime;

      // Verify timeout worked
      expect(result.timedOut).toBe(true);
      expect(duration).toBeLessThan(1000); // Should not wait full 5 seconds
      expect(result.exitCode).not.toBe(0);
    });

    it('should enforce output limits', async () => {
      const chattyHook: TextHook = {
        name: 'output-limit-test',
        command: [
          'sh',
          '-c',
          'i=1; while [ $i -le 10000 ]; do echo "Line $i: This is a long line that will exceed limits"; i=$((i+1)); done',
        ],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
        message: 'Output test',
      };

      const context: ExecutionContext = {
        event: {
          hook_event_name: 'Stop',
          session_id: 'output-test',
          transcript_path: '',
          cwd: testDir,
        },
        resourceLimits: {
          maxOutputBytes: 1024, // 1KB limit
          timeoutMs: 5000,
        },
      };

      const result = await executor.execute(chattyHook, context);

      // Verify output was truncated
      expect(result.truncated).toBe(true);
      expect(result.rawOutput.length).toBeLessThanOrEqual(1024);
    });
  });

  describe('3. Exit Code Mapping and Flow Control', () => {
    let executor: HookExecutor;

    beforeEach(() => {
      executor = new HookExecutor();
    });

    afterEach(async () => {
      await executor.shutdown();
    });

    it('should map exit codes to flow control actions', async () => {
      const testCases = [
        { exitCode: 0, expected: 'success' },
        { exitCode: 1, expected: 'non-blocking-error' },
        { exitCode: 2, expected: 'blocking-error' },
        { exitCode: 99, expected: 'non-blocking-error' }, // default
      ];

      for (const testCase of testCases) {
        const hook: TextHook = {
          name: `exit-${testCase.exitCode}`,
          command: ['sh', '-c', `exit ${testCase.exitCode}`],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: {
            '0': 'success',
            '1': 'non-blocking-error',
            '2': 'blocking-error',
            default: 'non-blocking-error',
          },
          message: `Exit code ${testCase.exitCode}`,
        };

        const context: ExecutionContext = {
          event: {
            hook_event_name: 'Stop',
            session_id: `exit-test-${testCase.exitCode}`,
            transcript_path: '',
            cwd: testDir,
          },
        };

        const result = await executor.execute(hook, context);

        expect(result.exitCode).toBe(testCase.exitCode);
        expect(result.flowControl).toBe(testCase.expected);
      }
    });

    it('should handle structured hook JSON output', async () => {
      const structuredHook: StructuredHook = {
        name: 'structured-test',
        command: ['sh', '-c', 'echo \'{"success": true, "message": "All good"}\''],
        events: ['PreToolUse'],
        outputFormat: 'structured',
      };

      const context: ExecutionContext = {
        event: {
          hook_event_name: 'PreToolUse',
          tool_name: 'Edit',
          session_id: 'structured-test',
          transcript_path: '',
          cwd: testDir,
        },
      };

      const result = await executor.execute(structuredHook, context);

      expect(result.jsonOutput).toBeDefined();
      expect(result.jsonOutput?.success).toBe(true);
      expect(result.jsonOutput?.message).toBe('All good');
      expect(result.flowControl).toBe('success');
    });
  });

  describe('4. Parallel Execution', () => {
    let executor: HookExecutor;

    beforeEach(() => {
      executor = new HookExecutor();
    });

    afterEach(async () => {
      await executor.shutdown();
    });

    it('should execute multiple hooks in parallel', async () => {
      const hooks: TextHook[] = [];
      const HOOK_COUNT = 5;

      for (let i = 1; i <= HOOK_COUNT; i++) {
        hooks.push({
          name: `parallel-${i}`,
          command: ['sh', '-c', `sleep 0.2 && echo "Hook ${i} done"`],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
          message: `Hook ${i}`,
          priority: i, // Different priorities
        });
      }

      const context: ExecutionContext = {
        event: {
          hook_event_name: 'Stop',
          session_id: 'parallel-test',
          transcript_path: '',
          cwd: testDir,
        },
      };

      const startTime = Date.now();
      const results = await executor.executeAll(hooks, context);
      const totalTime = Date.now() - startTime;

      // If run sequentially, would take 1000ms (5 * 200ms)
      // In parallel, should complete in ~200ms
      expect(totalTime).toBeLessThan(600); // Allow some overhead

      // Verify all hooks executed
      expect(results).toHaveLength(HOOK_COUNT);
      for (let i = 0; i < HOOK_COUNT; i++) {
        expect(results[i]?.exitCode).toBe(0);
        expect(results[i]?.rawOutput).toContain(`Hook ${i + 1} done`);
      }
    });

    it('should handle mixed success and failure in parallel', async () => {
      const hooks: TextHook[] = [
        {
          name: 'success-1',
          command: ['echo', 'Success 1'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
          message: 'Success 1',
        },
        {
          name: 'failure-1',
          command: ['sh', '-c', 'echo "Error!" >&2 && exit 1'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success', '1': 'blocking-error', default: 'non-blocking-error' },
          message: 'Failure 1',
        },
        {
          name: 'success-2',
          command: ['echo', 'Success 2'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
          message: 'Success 2',
        },
      ];

      const context: ExecutionContext = {
        event: {
          hook_event_name: 'Stop',
          session_id: 'mixed-parallel-test',
          transcript_path: '',
          cwd: testDir,
        },
      };

      const results = await executor.executeAll(hooks, context);

      expect(results).toHaveLength(3);
      expect(results[0]?.flowControl).toBe('success');
      expect(results[0]?.rawOutput.trim()).toBe('Success 1');
      expect(results[1]?.flowControl).toBe('blocking-error');
      expect(results[2]?.flowControl).toBe('success');
      expect(results[2]?.rawOutput.trim()).toBe('Success 2');
    });
  });

  describe('5. Event Filtering and Matching', () => {
    it('should only execute hooks for matching events', async () => {
      // Initialize
      const init = new InitCommand(testDir);
      await init.execute({ force: true });

      // Install hooks for different events
      const hooks = [
        {
          name: 'stop-hook',
          command: ['echo', 'Stop hook executed'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
          message: 'Stop',
        },
        {
          name: 'tool-hook',
          command: ['echo', 'Tool hook executed'],
          events: ['PreToolUse'],
          matcher: 'Edit',
          outputFormat: 'text',
          exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
          message: 'Tool',
        },
        {
          name: 'session-hook',
          command: ['echo', 'Session hook executed'],
          events: ['SessionStart'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
          message: 'Session',
        },
      ];

      // Write config with all hooks
      const configPath = path.join(testDir, '.claude', 'cc-hooks.json');
      fs.writeFileSync(configPath, JSON.stringify({ hooks }));

      // Test 1: Stop event should only run stop-hook
      const run = new RunCommand(testDir);
      const stopEvent = {
        hook_event_name: 'Stop',
        session_id: 'event-filter-test',
        transcript_path: '',
        cwd: testDir,
      };

      const mockStdin1 = require('stream').Readable.from([JSON.stringify(stopEvent)]);
      Object.defineProperty(process, 'stdin', { value: mockStdin1, configurable: true });

      const consoleLog = jest.spyOn(console, 'log').mockImplementation();
      const exitMock = mockProcessExit();

      const result = await executeWithExitCapture(async () => {
        await run.execute();
      });

      // Check for real errors
      if (result.error) {
        throw result.error; // Fail the test on real errors
      }
      expect(result.exited).toBe(true);
      expect(result.exitCode).toBe(0);

      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Stop hook executed'));
      expect(consoleLog).not.toHaveBeenCalledWith(expect.stringContaining('Tool hook executed'));
      expect(consoleLog).not.toHaveBeenCalledWith(expect.stringContaining('Session hook executed'));

      consoleLog.mockClear();

      // Test 2: PreToolUse with Edit should only run tool-hook
      const toolEvent = {
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        session_id: 'tool-test',
        transcript_path: '',
        cwd: testDir,
      };

      const mockStdin2 = require('stream').Readable.from([JSON.stringify(toolEvent)]);
      Object.defineProperty(process, 'stdin', { value: mockStdin2, configurable: true });

      const result2 = await executeWithExitCapture(async () => {
        await run.execute();
      });

      if (result2.error) {
        throw result2.error;
      }
      expect(result2.exited).toBe(true);
      expect(result2.exitCode).toBe(0);

      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Tool hook executed'));
      expect(consoleLog).not.toHaveBeenCalledWith(expect.stringContaining('Stop hook executed'));

      // Test 3: PreToolUse with different tool should not run tool-hook
      consoleLog.mockClear();

      const otherToolEvent = {
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        session_id: 'other-tool-test',
        transcript_path: '',
        cwd: testDir,
      };

      const mockStdin3 = require('stream').Readable.from([JSON.stringify(otherToolEvent)]);
      Object.defineProperty(process, 'stdin', { value: mockStdin3, configurable: true });

      const result3 = await executeWithExitCapture(async () => {
        await run.execute();
      });

      // THIS IS WHERE THE BUG WILL SHOW UP
      if (result3.error) {
        throw result3.error; // This will now properly fail the test!
      }

      expect(result3.exited).toBe(true);
      expect(result3.exitCode).toBe(0); // Short-circuit exit

      // Should not execute any hook since tool doesn't match
      expect(consoleLog).not.toHaveBeenCalledWith(expect.stringContaining('Tool hook executed'));

      consoleLog.mockRestore();
      exitMock.restore();
    });
  });
});
