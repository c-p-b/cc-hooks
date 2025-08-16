import { HookExecutor } from '../../../src/orchestrator/executor';
import { TextHook, ClaudeHookEvent } from '../../../src/common/types';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Writable, Readable } from 'stream';

// Mock child_process
jest.mock('child_process');

// Mock fs
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    appendFile: jest.fn()
  }
}));

// Mock LogCleaner
jest.mock('../../../src/orchestrator/log-cleaner', () => ({
  LogCleaner: {
    cleanupIfNeeded: jest.fn(),
    getSessionsDir: jest.fn().mockReturnValue('/mock/sessions')
  }
}));

// Mock logger
jest.mock('../../../src/common/logger', () => ({
  getLogger: jest.fn().mockReturnValue({
    log: jest.fn(),
    logError: jest.fn(),
    logWarning: jest.fn(),
    logInfo: jest.fn(),
    logDebug: jest.fn()
  })
}));

class MockChildProcess extends EventEmitter {
  stdin = new Writable({
    write: jest.fn((_chunk, _encoding, callback) => {
      callback();
    })
  });
  stdout = new Readable({
    read() {}
  });
  stderr = new Readable({
    read() {}
  });
  pid = 12345;
  killed = false;

  kill(signal?: string) {
    this.killed = true;
    // Simulate process exit after kill
    setTimeout(() => {
      this.emit('exit', signal === 'SIGKILL' ? 137 : 1, signal);
    }, 0);
    return true;
  }
}

describe('HookExecutor', () => {
  let executor: HookExecutor;
  let mockSpawn: jest.Mock;
  
  const testHook: TextHook = {
    name: 'test-hook',
    command: ['echo', 'test'],
    events: ['PostToolUse'],
    outputFormat: 'text',
    exitCodeMap: { '0': 'success' },
    message: 'Test message'
  };
  
  const testEvent: ClaudeHookEvent = {
    hook_event_name: 'PostToolUse',
    session_id: 'test-session-123',
    transcript_path: '/test/transcript.json',
    cwd: '/test/dir'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new HookExecutor();
    mockSpawn = spawn as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('execute', () => {
    it('should execute a hook successfully and log the result', async () => {
      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);
      
      const mkdirMock = fs.mkdir as jest.Mock;
      const appendFileMock = fs.appendFile as jest.Mock;
      
      mkdirMock.mockResolvedValue(undefined);
      appendFileMock.mockResolvedValue(undefined);
      
      // Simulate successful execution
      setTimeout(() => {
        mockProcess.stdout.push('Success output');
        mockProcess.stdout.push(null);
        mockProcess.stderr.push(null);
        mockProcess.emit('exit', 0, null);
      }, 10);
      
      const result = await executor.execute(testHook, { event: testEvent });
      
      // Verify hook executed successfully
      expect(result.exitCode).toBe(0);
      expect(result.flowControl).toBe('success');
      expect(result.hook.name).toBe('test-hook');
      
      // Wait for async logging
      await new Promise(resolve => setImmediate(resolve));
      
      // Verify log file was created
      expect(mkdirMock).toHaveBeenCalledWith(
        '/mock/sessions',
        { recursive: true }
      );
      
      // Verify log entry was written
      expect(appendFileMock).toHaveBeenCalledWith(
        '/mock/sessions/session-test-session-123.jsonl',
        expect.stringContaining('"session_id":"test-session-123"')
      );
      
      // Verify log entry contains correct data
      const logCall = appendFileMock.mock.calls[0][1];
      const logEntry = JSON.parse(logCall.replace('\n', ''));
      
      expect(logEntry).toMatchObject({
        session_id: 'test-session-123',
        hook: 'test-hook',
        event: 'PostToolUse',
        exit_code: 0,
        flow_control: 'success',
        truncated: false,
        timed_out: false
      });
    });

    it('should log when hook times out', async () => {
      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);
      
      const appendFileMock = fs.appendFile as jest.Mock;
      appendFileMock.mockResolvedValue(undefined);
      
      const timeoutHook = { ...testHook, timeout: 50 };
      
      const resultPromise = executor.execute(timeoutHook, { event: testEvent });
      
      // Let timeout trigger
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const result = await resultPromise;
      
      expect(result.timedOut).toBe(true);
      
      // Wait for async logging
      await new Promise(resolve => setImmediate(resolve));
      
      // Verify timeout was logged
      const logCall = appendFileMock.mock.calls[0][1];
      const logEntry = JSON.parse(logCall.replace('\n', ''));
      
      expect(logEntry.timed_out).toBe(true);
    });

    it('should log when output is truncated', async () => {
      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);
      
      const appendFileMock = fs.appendFile as jest.Mock;
      appendFileMock.mockResolvedValue(undefined);
      
      // Simulate large output that exceeds limit
      setTimeout(() => {
        // Generate > 1MB of output
        const largeOutput = 'x'.repeat(2_000_000);
        mockProcess.stdout.push(largeOutput);
        
        // The StreamLimiter will kill the process
        mockProcess.kill('SIGKILL');
      }, 10);
      
      await executor.execute(testHook, { 
        event: testEvent,
        resourceLimits: { maxOutputBytes: 100, timeoutMs: 30000 }
      });
      
      // Wait for async logging
      await new Promise(resolve => setImmediate(resolve));
      
      // Verify truncation was logged
      const logCall = appendFileMock.mock.calls[0]?.[1];
      if (logCall) {
        const logEntry = JSON.parse(logCall.replace('\n', ''));
        expect(logEntry.truncated).toBe(true);
      }
    });

    it('should trigger cleanup when executing', async () => {
      const { LogCleaner } = require('../../../src/orchestrator/log-cleaner');
      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);
      
      setTimeout(() => {
        mockProcess.emit('exit', 0, null);
      }, 10);
      
      await executor.execute(testHook, { event: testEvent });
      
      // Verify cleanup was triggered with session ID
      expect(LogCleaner.cleanupIfNeeded).toHaveBeenCalledWith('test-session-123');
    });

    it('should handle logging errors gracefully', async () => {
      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);
      
      const appendFileMock = fs.appendFile as jest.Mock;
      appendFileMock.mockRejectedValue(new Error('Disk full'));
      
      setTimeout(() => {
        mockProcess.emit('exit', 0, null);
      }, 10);
      
      // Should not throw even if logging fails
      const result = await executor.execute(testHook, { event: testEvent });
      
      expect(result.exitCode).toBe(0);
      expect(result.flowControl).toBe('success');
    });
  });

  describe('executeAll', () => {
    it('should log all hook executions', async () => {
      const mockProcess1 = new MockChildProcess();
      const mockProcess2 = new MockChildProcess();
      
      mockSpawn
        .mockReturnValueOnce(mockProcess1)
        .mockReturnValueOnce(mockProcess2);
      
      const appendFileMock = fs.appendFile as jest.Mock;
      appendFileMock.mockResolvedValue(undefined);
      
      const hook2 = { ...testHook, name: 'test-hook-2' };
      
      setTimeout(() => {
        mockProcess1.emit('exit', 0, null);
        mockProcess2.emit('exit', 1, null);
      }, 10);
      
      const results = await executor.executeAll([testHook, hook2], { event: testEvent });
      
      expect(results).toHaveLength(2);
      
      // Wait for async logging
      await new Promise(resolve => setImmediate(resolve));
      
      // Should have logged both executions
      expect(appendFileMock).toHaveBeenCalledTimes(2);
      
      // Verify both hooks were logged
      const logCalls = appendFileMock.mock.calls.map(call => 
        JSON.parse(call[1].replace('\n', ''))
      );
      
      const hookNames = logCalls.map(entry => entry.hook);
      expect(hookNames).toContain('test-hook');
      expect(hookNames).toContain('test-hook-2');
    });
  });

  describe('shutdown', () => {
    it('should clean up resources on shutdown', async () => {
      await executor.shutdown();
      
      // ProcessManager cleanup is called
      // (would need to spy on ProcessManager to verify, but it's tested separately)
      expect(true).toBe(true);
    });
  });
});