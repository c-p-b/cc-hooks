import { TestCommand } from '../../src/commands/test';
import { InitTestCommand } from '../../src/commands/init-test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

jest.mock('child_process', () => ({
  execSync: jest.fn()
}));

describe('Test Command - Integration', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create real temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hooks-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    
    // Create a minimal cc-hooks.json
    fs.mkdirSync(path.join(tempDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.claude', 'cc-hooks.json'),
      JSON.stringify({
        hooks: [{
          name: 'test-hook',
          command: ['echo', 'test'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success' },
          message: 'Test message'
        }]
      }, null, 2)
    );
    
    // Reset mock
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should generate test events with init-test', async () => {
    const initTestCommand = new InitTestCommand(tempDir);
    await initTestCommand.execute();
    
    const testDir = path.join(tempDir, '.claude', 'cc-hooks', 'test-events');
    expect(fs.existsSync(testDir)).toBe(true);
    
    const files = fs.readdirSync(testDir);
    expect(files).toContain('Stop.json');
    expect(files).toContain('PostToolUse-Edit.json');
    
    // Verify files are valid JSON
    files.forEach(file => {
      const content = fs.readFileSync(path.join(testDir, file), 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });
  });

  it('should run test events through cc-hooks run', async () => {
    // First create test events
    const initTestCommand = new InitTestCommand(tempDir);
    await initTestCommand.execute();
    
    // Mock execSync to return success
    (execSync as jest.Mock).mockReturnValue('');
    
    // Mock console to capture output
    const consoleSpy = jest.spyOn(console, 'log');
    
    // Mock process.exit to prevent test from exiting
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    
    // Run tests
    const testCommand = new TestCommand(tempDir);
    
    try {
      await testCommand.execute('Stop.json');
    } catch (e: any) {
      // Expected - process.exit was called
      expect(e.message).toBe('process.exit called');
    }
    
    // Should have logged test execution
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Testing: Stop.json')
    );
    
    // Should have called execSync with correct params
    expect(execSync).toHaveBeenCalledWith('cc-hooks run', expect.objectContaining({
      input: expect.stringContaining('Stop'),
      encoding: 'utf-8',
      timeout: 65000
    }));
    
    // Should exit with 0 (success)
    expect(processExitSpy).toHaveBeenCalledWith(0);
    
    consoleSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should handle timeout correctly', async () => {
    // Create a hook that would timeout
    fs.writeFileSync(
      path.join(tempDir, '.claude', 'cc-hooks.json'),
      JSON.stringify({
        hooks: [{
          name: 'slow-hook',
          command: ['sleep', '70'],  // Would timeout
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success' },
          message: 'Slow'
        }]
      }, null, 2)
    );
    
    const initTestCommand = new InitTestCommand(tempDir);
    await initTestCommand.execute();
    
    // Mock execSync to throw timeout error
    const timeoutError: any = new Error('Command failed: cc-hooks run');
    timeoutError.status = 1;
    timeoutError.stderr = 'ETIMEDOUT';
    (execSync as jest.Mock).mockImplementation(() => {
      throw timeoutError;
    });
    
    const testCommand = new TestCommand(tempDir);
    
    // This should timeout and exit with code 1
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    
    try {
      await testCommand.execute('Stop.json');
    } catch (e: any) {
      expect(e.message).toBe('process.exit called');
    }
    
    expect(processExitSpy).toHaveBeenCalledWith(1);
    
    processExitSpy.mockRestore();
  });
});