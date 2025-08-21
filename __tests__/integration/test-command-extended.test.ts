import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TestCommand } from '../../src/commands/test';
import { execSync } from 'child_process';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

describe('TestCommand Extended Coverage', () => {
  let tempDir: string;
  let testEventsDir: string;
  let originalCwd: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalHome = process.env.HOME;
    
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hooks-test-'));
    testEventsDir = path.join(tempDir, '.claude', 'cc-hooks', 'test-events');
    fs.mkdirSync(testEventsDir, { recursive: true });
    
    // Isolate test environment
    process.chdir(tempDir);
    process.env.HOME = tempDir;
    
    // Reset mock
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHome) process.env.HOME = originalHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Error handling', () => {
    test('should handle non-initialized test events directory', async () => {
      const testCommand = new TestCommand(tempDir);

      // Remove the test events directory
      fs.rmSync(testEventsDir, { recursive: true, force: true });

      const consoleSpy = jest.spyOn(console, 'log');

      // This should just return early, not throw
      await testCommand.execute();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No test events found'));
      consoleSpy.mockRestore();
    });

    test('should handle empty test events directory', async () => {
      const testCommand = new TestCommand(tempDir);
      
      // Create config so we get past config check
      const configPath = path.join(tempDir, '.claude', 'cc-hooks.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({ hooks: [{ name: 'test', events: ['Stop'], command: ['echo'], outputFormat: 'text', exitCodeMap: {'0': 'success'}, message: 'test' }] }));

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // Directory exists but is empty - should just return
      await testCommand.execute();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No test event files found'));
      consoleSpy.mockRestore();
    });

    test('should handle invalid JSON in test event file', async () => {
      const testCommand = new TestCommand(tempDir);
      
      // Create config
      const configPath = path.join(tempDir, '.claude', 'cc-hooks.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({ hooks: [{ name: 'test', events: ['Stop'], command: ['echo'], outputFormat: 'text', exitCodeMap: {'0': 'success'}, message: 'test' }] }));

      // Create an invalid JSON file
      fs.writeFileSync(path.join(testEventsDir, 'invalid.json'), 'not valid json');
      
      // Mock execSync
      (execSync as jest.Mock).mockReturnValue('');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // Should try to parse and report the error
      await testCommand.execute();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error: SyntaxError'));
      consoleSpy.mockRestore();
    });

    test('should handle missing config file', async () => {
      const testCommand = new TestCommand(tempDir);

      // Create a valid test event
      const event = {
        hook_event_name: 'Stop',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: tempDir,
      };
      fs.writeFileSync(path.join(testEventsDir, 'Stop.json'), JSON.stringify(event, null, 2));

      const consoleSpy = jest.spyOn(console, 'log');

      // No config file exists - should just log and return
      await testCommand.execute();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No cc-hooks configuration found'),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('Specific event testing', () => {
    test('should test only specific event when provided', async () => {
      const testCommand = new TestCommand(tempDir);

      // Create config
      const configPath = path.join(tempDir, '.claude', 'cc-hooks.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const config = {
        hooks: [
          {
            name: 'stop-hook',
            outputFormat: 'text',
            command: ['echo', 'STOP_HOOK'],
            events: ['Stop'],
            exitCodeMap: { '0': 'success' },
            message: 'Stop hook',
          },
          {
            name: 'start-hook',
            outputFormat: 'text',
            command: ['echo', 'START_HOOK'],
            events: ['SessionStart'],
            exitCodeMap: { '0': 'success' },
            message: 'Start hook',
          },
        ],
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Create test events
      const stopEvent = {
        hook_event_name: 'Stop',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: tempDir,
      };
      fs.writeFileSync(path.join(testEventsDir, 'Stop.json'), JSON.stringify(stopEvent, null, 2));

      const startEvent = {
        hook_event_name: 'SessionStart',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: tempDir,
        source: 'startup',
      };
      fs.writeFileSync(
        path.join(testEventsDir, 'SessionStart.json'),
        JSON.stringify(startEvent, null, 2),
      );

      // Mock console.log to capture output
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      // Mock execSync to succeed
      (execSync as jest.Mock).mockReturnValue('');
      
      // Mock process.exit

      // Test only Stop event
      await testCommand.execute('Stop.json');

      // Check that only Stop hook was tested
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Testing: Stop.json'));
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Testing: SessionStart.json'),
      );

      consoleSpy.mockRestore();
    });

    test('should handle event file not found', async () => {
      const testCommand = new TestCommand(tempDir);

      // Create config with at least one hook
      const configPath = path.join(tempDir, '.claude', 'cc-hooks.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const config = { hooks: [{ name: 'test', events: ['Stop'], command: ['echo'], outputFormat: 'text', exitCodeMap: {'0': 'success'}, message: 'test' }] };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Create at least one event so directory isn't empty
      const event = {
        hook_event_name: 'Stop',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: tempDir,
      };
      fs.writeFileSync(path.join(testEventsDir, 'Stop.json'), JSON.stringify(event, null, 2));

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await testCommand.execute('NonExistent.json');
      
      // Should log error about file not found
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error:'));
      consoleSpy.mockRestore();
    });
  });

  describe('Hook execution results', () => {
    test('should report success for passing hooks', async () => {
      const testCommand = new TestCommand(tempDir);
      
      // Mock execSync to succeed
      (execSync as jest.Mock).mockReturnValue('');

      // Create config
      const configPath = path.join(tempDir, '.claude', 'cc-hooks.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const config = {
        hooks: [
          {
            name: 'success-hook',
            outputFormat: 'text',
            command: ['echo', 'SUCCESS'],
            events: ['Stop'],
            exitCodeMap: { '0': 'success' },
            message: 'Success hook',
          },
        ],
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Create test event
      const event = {
        hook_event_name: 'Stop',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: tempDir,
      };
      fs.writeFileSync(path.join(testEventsDir, 'Stop.json'), JSON.stringify(event, null, 2));

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await testCommand.execute();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✓'));

      consoleSpy.mockRestore();
    });

    test('should report non-blocking errors', async () => {
      const testCommand = new TestCommand(tempDir);
      
      // Mock execSync to throw non-blocking error (exit 1)
      const error: any = new Error('Command failed');
      error.status = 1;
      (execSync as jest.Mock).mockImplementation(() => {
        throw error;
      });

      // Create config
      const configPath = path.join(tempDir, '.claude', 'cc-hooks.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const config = {
        hooks: [
          {
            name: 'warning-hook',
            outputFormat: 'text',
            command: ['sh', '-c', 'exit 1'],
            events: ['Stop'],
            exitCodeMap: { '1': 'non-blocking-error' },
            message: 'Warning hook',
          },
        ],
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Create test event
      const event = {
        hook_event_name: 'Stop',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: tempDir,
      };
      fs.writeFileSync(path.join(testEventsDir, 'Stop.json'), JSON.stringify(event, null, 2));

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await testCommand.execute();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✗ Failed'));

      consoleSpy.mockRestore();
    });

    test('should report blocking errors', async () => {
      const testCommand = new TestCommand(tempDir);
      
      // Mock execSync to throw blocking error (exit 2)
      const error: any = new Error('Command failed');
      error.status = 2;
      (execSync as jest.Mock).mockImplementation(() => {
        throw error;
      });

      // Create config
      const configPath = path.join(tempDir, '.claude', 'cc-hooks.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const config = {
        hooks: [
          {
            name: 'blocking-hook',
            outputFormat: 'text',
            command: ['sh', '-c', 'exit 2'],
            events: ['Stop'],
            exitCodeMap: { '2': 'blocking-error' },
            message: 'Blocking hook',
          },
        ],
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Create test event
      const event = {
        hook_event_name: 'Stop',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: tempDir,
      };
      fs.writeFileSync(path.join(testEventsDir, 'Stop.json'), JSON.stringify(event, null, 2));

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await testCommand.execute();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Blocked'));

      consoleSpy.mockRestore();
    });
  });

  describe('Summary reporting', () => {
    test('should show summary of all test results', async () => {
      const testCommand = new TestCommand(tempDir);
      
      // Mock execSync to succeed
      (execSync as jest.Mock).mockReturnValue('');

      // Create config with multiple hooks
      const configPath = path.join(tempDir, '.claude', 'cc-hooks.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const config = {
        hooks: [
          {
            name: 'success-hook',
            outputFormat: 'text',
            command: ['echo', 'SUCCESS'],
            events: ['Stop'],
            exitCodeMap: { '0': 'success' },
            message: 'Success hook',
          },
          {
            name: 'warning-hook',
            outputFormat: 'text',
            command: ['sh', '-c', 'exit 1'],
            events: ['SessionStart'],
            exitCodeMap: { '1': 'non-blocking-error' },
            message: 'Warning hook',
          },
        ],
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Create test events
      const stopEvent = {
        hook_event_name: 'Stop',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: tempDir,
      };
      fs.writeFileSync(path.join(testEventsDir, 'Stop.json'), JSON.stringify(stopEvent, null, 2));

      const startEvent = {
        hook_event_name: 'SessionStart',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: tempDir,
        source: 'startup',
      };
      fs.writeFileSync(
        path.join(testEventsDir, 'SessionStart.json'),
        JSON.stringify(startEvent, null, 2),
      );

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      // First test will succeed, second will return exit 1
      let callCount = 0;
      (execSync as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          const error: any = new Error('Command failed');
          error.status = 1;
          throw error;
        }
        return '';
      });

      await testCommand.execute(); // Failed test exists

      // Check for summary
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test Summary'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1 passed'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1 failed'));

      consoleSpy.mockRestore();
    });
  });

  describe('Test events with matchers', () => {
    test('should test hooks with matchers correctly', async () => {
      const testCommand = new TestCommand(tempDir);

      // Create config with matcher
      const configPath = path.join(tempDir, '.claude', 'cc-hooks.json');
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const config = {
        hooks: [
          {
            name: 'edit-hook',
            outputFormat: 'text',
            command: ['echo', 'EDIT_HOOK'],
            events: ['PostToolUse'],
            matcher: 'Edit',
            exitCodeMap: { '0': 'success' },
            message: 'Edit hook',
          },
        ],
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Create test event with tool_name
      const event = {
        hook_event_name: 'PostToolUse',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: tempDir,
        tool_name: 'Edit',
      };
      fs.writeFileSync(
        path.join(testEventsDir, 'PostToolUse-Edit.json'),
        JSON.stringify(event, null, 2),
      );

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await testCommand.execute();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✓'));

      consoleSpy.mockRestore();
    });
  });
});
