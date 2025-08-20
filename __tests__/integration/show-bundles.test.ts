import { ShowCommand } from '../../src/commands/show';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Show Command - Bundle Display', () => {
  let tempDir: string;
  let originalCwd: string;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hooks-show-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    
    // Create a config with both bundled and standalone hooks
    fs.mkdirSync(path.join(tempDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.claude', 'cc-hooks.json'),
      JSON.stringify({
        hooks: [
          {
            name: 'typescript:eslint',
            description: 'ESLint check',
            events: ['PostToolUse'],
            outputFormat: 'text',
            command: ['eslint'],
            exitCodeMap: { '0': 'success' },
            message: 'Linting'
          },
          {
            name: 'typescript:prettier',
            description: 'Prettier check',
            events: ['PostToolUse'],
            outputFormat: 'text',
            command: ['prettier'],
            exitCodeMap: { '0': 'success' },
            message: 'Formatting'
          },
          {
            name: 'standalone-hook',
            description: 'A standalone hook',
            events: ['Stop'],
            outputFormat: 'text',
            command: ['echo', 'test'],
            exitCodeMap: { '0': 'success' },
            message: 'Test'
          },
          {
            name: 'python:black',
            description: 'Black formatter',
            events: ['PostToolUse'],
            outputFormat: 'text',
            command: ['black'],
            exitCodeMap: { '0': 'success' },
            message: 'Formatting Python'
          }
        ]
      }, null, 2)
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
  });

  it('should group hooks by bundle', async () => {
    const command = new ShowCommand(tempDir);
    await command.execute();

    // Should show typescript bundle - check the calls for the bundle line
    const calls = consoleSpy.mock.calls;
    const bundleCall = calls.find(call => 
      call.some((arg: any) => arg && arg.toString().includes('typescript bundle'))
    );
    expect(bundleCall).toBeDefined();
    expect(bundleCall?.some((arg: any) => arg && arg.toString().includes('(2 hooks)'))).toBe(true);

    // Should show python bundle
    const pythonCall = calls.find(call => 
      call.some((arg: any) => arg && arg.toString().includes('python bundle'))
    );
    expect(pythonCall).toBeDefined();
    expect(pythonCall?.some((arg: any) => arg && arg.toString().includes('(1 hook'))).toBe(true);

    // Should show standalone hooks section
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Standalone hooks')
    );

    // Should show standalone hook
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('standalone-hook')
    );
  });

  it('should show hook names without bundle prefix inside bundles', async () => {
    const command = new ShowCommand(tempDir);
    await command.execute();

    // Inside bundle, should show "eslint" not "typescript:eslint"
    const calls = consoleSpy.mock.calls.map(call => call.join(' '));
    const bundleSection = calls.join('\n');
    
    // After "typescript bundle" we should see "• eslint" not "• typescript:eslint"
    expect(bundleSection).toMatch(/typescript bundle.*\n.*• eslint/s);
    expect(bundleSection).toMatch(/typescript bundle.*\n.*• prettier/s);
  });

  it('should handle configs with no bundled hooks', async () => {
    // Overwrite with only standalone hooks
    fs.writeFileSync(
      path.join(tempDir, '.claude', 'cc-hooks.json'),
      JSON.stringify({
        hooks: [
          {
            name: 'my-hook',
            events: ['Stop'],
            outputFormat: 'text',
            command: ['echo'],
            exitCodeMap: { '0': 'success' },
            message: 'Test'
          }
        ]
      }, null, 2)
    );

    const command = new ShowCommand(tempDir);
    await command.execute();

    // Should not show "Standalone hooks:" header when there are no bundles
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Standalone hooks')
    );

    // Should show the hook directly
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('my-hook')
    );
  });
});