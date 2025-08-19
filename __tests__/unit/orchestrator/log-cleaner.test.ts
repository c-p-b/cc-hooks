import { LogCleaner } from '../../../src/orchestrator/log-cleaner';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock fs and os modules
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    readdir: jest.fn().mockResolvedValue([]),
    stat: jest.fn().mockRejectedValue(new Error('ENOENT')),
    unlink: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    appendFile: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('os');

describe('LogCleaner', () => {
  const mockHomeDir = '/mock/home';
  const mockLogsDir = '/mock/home/.claude/logs/cc-hooks';
  const mockSessionsDir = '/mock/home/.claude/logs/cc-hooks/sessions';
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
    (os.homedir as jest.Mock).mockReturnValue(mockHomeDir);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.restoreAllMocks();
  });

  describe('cleanupIfNeeded', () => {
    it('should create logs directory if it does not exist', async () => {
      jest.useFakeTimers();
      
      const statMock = fs.stat as jest.Mock;
      const mkdirMock = fs.mkdir as jest.Mock;
      const writeFileMock = fs.writeFile as jest.Mock;
      
      // Lock file doesn't exist
      statMock.mockRejectedValue(new Error('ENOENT'));
      // Lock acquisition succeeds
      writeFileMock.mockResolvedValue(undefined);
      
      LogCleaner.cleanupIfNeeded('test-session');
      
      // Wait for async operations
      await jest.runAllTimersAsync();
      
      expect(mkdirMock).toHaveBeenCalledWith(
        mockLogsDir,
        { recursive: true }
      );
      
      jest.useRealTimers();
    });

    it('should not cleanup if lock was acquired recently', async () => {
      jest.useFakeTimers();
      
      const statMock = fs.stat as jest.Mock;
      const unlinkMock = fs.unlink as jest.Mock;
      const mkdirMock = fs.mkdir as jest.Mock;
      
      // Ensure mkdir succeeds
      mkdirMock.mockResolvedValue(undefined);
      
      // Lock file exists and is recent (30 minutes old)
      statMock.mockResolvedValue({
        mtimeMs: Date.now() - (30 * 60 * 1000) // 30 minutes ago
      });
      
      LogCleaner.cleanupIfNeeded('test-session');
      
      // Wait for the async tryCleanup to complete
      await jest.runAllTimersAsync();
      
      // Should not attempt to remove lock or perform cleanup
      expect(unlinkMock).not.toHaveBeenCalled();
      
      jest.useRealTimers();
    });

    it('should remove stale lock and acquire new one', async () => {
      jest.useFakeTimers();
      
      const statMock = fs.stat as jest.Mock;
      const unlinkMock = fs.unlink as jest.Mock;
      const writeFileMock = fs.writeFile as jest.Mock;
      
      // Lock file exists but is old (2 hours)
      statMock.mockResolvedValueOnce({
        mtimeMs: Date.now() - (2 * 60 * 60 * 1000) // 2 hours ago
      });
      
      // Remove stale lock succeeds
      unlinkMock.mockResolvedValue(undefined);
      
      // Acquire new lock succeeds
      writeFileMock.mockResolvedValue(undefined);
      
      LogCleaner.cleanupIfNeeded('test-session');
      
      await jest.runAllTimersAsync();
      
      expect(unlinkMock).toHaveBeenCalledWith(
        path.join(mockLogsDir, '.cleanup.lock')
      );
      
      expect(writeFileMock).toHaveBeenCalledWith(
        path.join(mockLogsDir, '.cleanup.lock'),
        expect.stringContaining('test-session'),
        { flag: 'wx' }
      );
      
      jest.useRealTimers();
    });

    it('should not cleanup if another process has the lock', async () => {
      jest.useFakeTimers();
      
      const statMock = fs.stat as jest.Mock;
      const writeFileMock = fs.writeFile as jest.Mock;
      const readdirMock = fs.readdir as jest.Mock;
      
      // No existing lock
      statMock.mockRejectedValue(new Error('ENOENT'));
      
      // Lock acquisition fails (another process got it)
      writeFileMock.mockRejectedValue(new Error('EEXIST'));
      
      LogCleaner.cleanupIfNeeded('test-session');
      
      await jest.runAllTimersAsync();
      
      // Should not perform cleanup
      expect(readdirMock).not.toHaveBeenCalled();
      
      jest.useRealTimers();
    });
  });

  describe('performCleanup', () => {
    it('should delete files older than 7 days', async () => {
      jest.useFakeTimers();
      
      const readdirMock = fs.readdir as jest.Mock;
      const statMock = fs.stat as jest.Mock;
      const unlinkMock = fs.unlink as jest.Mock;
      const writeFileMock = fs.writeFile as jest.Mock;
      
      // Mock directory listing
      readdirMock.mockResolvedValue([
        'session-old.jsonl',
        'session-recent.jsonl',
        'not-a-log.txt'
      ]);
      
      const now = Date.now();
      const eightDaysAgo = now - (8 * 24 * 60 * 60 * 1000);
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      
      // Set up mocks for successful lock acquisition and file stats
      statMock
        .mockRejectedValueOnce(new Error('ENOENT')) // No lock file
        .mockResolvedValueOnce({ // old file
          size: 1000,
          mtimeMs: eightDaysAgo
        })
        .mockResolvedValueOnce({ // recent file
          size: 1000,
          mtimeMs: oneDayAgo
        });
      
      writeFileMock.mockResolvedValue(undefined); // Lock acquired
      
      LogCleaner.cleanupIfNeeded('test-session');
      
      // Wait for cleanup to complete
      await jest.runAllTimersAsync();
      
      // Should only delete the old file
      expect(unlinkMock).toHaveBeenCalledTimes(2); // Once for lock removal, once for old file
      expect(unlinkMock).toHaveBeenCalledWith(
        path.join(mockSessionsDir, 'session-old.jsonl')
      );
      
      jest.useRealTimers();
    });

    it('should delete files when total size exceeds 500MB', async () => {
      jest.useFakeTimers();
      
      const readdirMock = fs.readdir as jest.Mock;
      const statMock = fs.stat as jest.Mock;
      const unlinkMock = fs.unlink as jest.Mock;
      const writeFileMock = fs.writeFile as jest.Mock;
      
      readdirMock.mockResolvedValue([
        'session-1.jsonl',
        'session-2.jsonl',
        'session-3.jsonl'
      ]);
      
      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      
      // Set up mocks for successful lock acquisition and file stats
      statMock
        .mockRejectedValueOnce(new Error('ENOENT')) // No lock file
        .mockResolvedValueOnce({
          size: 200_000_000, // 200MB
          mtimeMs: oneDayAgo - 2000 // Oldest
        })
        .mockResolvedValueOnce({
          size: 200_000_000, // 200MB
          mtimeMs: oneDayAgo - 1000
        })
        .mockResolvedValueOnce({
          size: 200_000_000, // 200MB (total = 600MB)
          mtimeMs: oneDayAgo // Newest
        });
      
      writeFileMock.mockResolvedValue(undefined);
      
      LogCleaner.cleanupIfNeeded('test-session');
      
      await jest.runAllTimersAsync();
      
      // Should delete the oldest file to get under 500MB
      expect(unlinkMock).toHaveBeenCalledWith(
        path.join(mockSessionsDir, 'session-1.jsonl')
      );
      
      jest.useRealTimers();
    });

    it('should handle cleanup errors gracefully', async () => {
      jest.useFakeTimers();
      
      const readdirMock = fs.readdir as jest.Mock;
      const statMock = fs.stat as jest.Mock;
      const unlinkMock = fs.unlink as jest.Mock;
      const writeFileMock = fs.writeFile as jest.Mock;
      
      // Set up lock acquisition
      statMock.mockRejectedValueOnce(new Error('ENOENT')); // No lock file
      writeFileMock.mockResolvedValue(undefined);
      
      // readdir fails
      readdirMock.mockRejectedValue(new Error('Permission denied'));
      
      // Should not throw
      expect(() => {
        LogCleaner.cleanupIfNeeded('test-session');
      }).not.toThrow();
      
      await jest.runAllTimersAsync();
      
      // Lock should still be removed (best effort)
      expect(unlinkMock).toHaveBeenCalledWith(
        path.join(mockLogsDir, '.cleanup.lock')
      );
      
      jest.useRealTimers();
    });
  });

  describe('getSessionsDir', () => {
    it('should return the correct sessions directory path', () => {
      const sessionsDir = LogCleaner.getSessionsDir();
      expect(sessionsDir).toBe(mockSessionsDir);
    });
  });
});