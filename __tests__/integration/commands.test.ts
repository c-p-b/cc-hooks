import { InitCommand } from '../../src/commands/init';
import { UninitCommand } from '../../src/commands/uninit';
import { InstallCommand } from '../../src/commands/install';
import { UninstallCommand } from '../../src/commands/uninstall';
import { ShowCommand } from '../../src/commands/show';
import { MigrateCommand } from '../../src/commands/migrate';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Command Integration Tests', () => {
  let testDir: string;
  let settingsPath: string;
  let configPath: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    // Save original HOME
    originalHome = process.env.HOME;

    // Create a temp directory for testing
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hooks-test-'));

    // Set HOME to temp directory to avoid polluting real home
    process.env.HOME = testDir;

    // Create .claude directory
    fs.mkdirSync(path.join(testDir, '.claude'));
    settingsPath = path.join(testDir, '.claude', 'settings.json');
    configPath = path.join(testDir, '.claude', 'cc-hooks.json');
  });

  afterEach(() => {
    // Restore original HOME
    if (originalHome) {
      process.env.HOME = originalHome;
    }

    // Clean up temp directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('InitCommand', () => {
    it('should initialize cc-hooks with empty settings', async () => {
      const init = new InitCommand(testDir);
      await init.execute({ force: true });

      // Check settings.json was created
      expect(fs.existsSync(settingsPath)).toBe(true);

      // Check it has orchestrator hooks
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe('cc-hooks run');

      // Check cc-hooks.json was created
      expect(fs.existsSync(configPath)).toBe(true);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.hooks).toEqual([]);
    });

    it('should detect existing vanilla hooks', async () => {
      // Create settings with vanilla hooks
      const vanillaSettings = {
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'npm test',
                },
              ],
            },
          ],
        },
      };
      fs.writeFileSync(settingsPath, JSON.stringify(vanillaSettings, null, 2));

      const consoleLog = jest.spyOn(console, 'log').mockImplementation();

      const init = new InitCommand(testDir);
      await init.execute();

      // Should warn about existing hooks
      expect(consoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Found 1 existing vanilla hook'),
      );

      consoleLog.mockRestore();
    });

    it('should not reinitialize without force flag', async () => {
      const init = new InitCommand(testDir);

      // First init with force
      await init.execute({ force: true });

      // Try to init again
      const consoleLog = jest.spyOn(console, 'log').mockImplementation();
      await init.execute();

      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('already initialized'));

      consoleLog.mockRestore();
    });

    it('should reinitialize with force flag', async () => {
      const init = new InitCommand(testDir);

      // First init
      await init.execute({ force: true });

      // Force reinit
      await init.execute({ force: true });

      // Should succeed without error
      expect(fs.existsSync(settingsPath)).toBe(true);
    });
  });

  describe('UninitCommand', () => {
    it('should remove cc-hooks from settings and delete config', async () => {
      // Initialize first
      const init = new InitCommand(testDir);
      await init.execute({ force: true });

      // Add a hook to config
      const config = { hooks: [{ name: 'test-hook' }] };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Uninit
      const uninit = new UninitCommand(testDir);
      await uninit.execute();

      // Check settings.json no longer has cc-hooks
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const hasOrchestratorHook = Object.values(settings.hooks || {}).some((eventHooks: any) =>
        eventHooks.some((matcher: any) =>
          matcher.hooks?.some((hook: any) => hook.command === 'cc-hooks run'),
        ),
      );
      expect(hasOrchestratorHook).toBe(false);

      // Check cc-hooks.json was deleted
      expect(fs.existsSync(configPath)).toBe(false);
    });

    it('should handle uninit when not initialized', async () => {
      const consoleLog = jest.spyOn(console, 'log').mockImplementation();

      const uninit = new UninitCommand(testDir);
      await uninit.execute();

      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('not initialized'));

      consoleLog.mockRestore();
    });
  });

  describe('InstallCommand', () => {
    beforeEach(async () => {
      // Initialize first (force since no existing settings)
      const init = new InitCommand(testDir);
      await init.execute({ force: true });
    });

    it('should install a built-in template', async () => {
      const install = new InstallCommand(testDir);
      await install.execute('typescript-lint');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.hooks).toHaveLength(1);
      expect(config.hooks[0].name).toBe('typescript-lint');
      expect(config.hooks[0].command).toContain('eslint');
    });

    it('should install from local JSON file', async () => {
      // Create a local hook file
      const hookDef = {
        name: 'local-hook',
        command: ['echo', 'test'],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
        message: 'Local hook',
      };
      fs.writeFileSync('test-hook.json', JSON.stringify(hookDef));

      const install = new InstallCommand(testDir);
      await install.execute('./test-hook.json');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.hooks).toHaveLength(1);
      expect(config.hooks[0].name).toBe('local-hook');
    });

    it('should reject duplicate hooks without force', async () => {
      const install = new InstallCommand(testDir);

      // Install once
      await install.execute('typescript-lint');

      // Try to install again
      await expect(install.execute('typescript-lint')).rejects.toThrow('already exists');
    });

    it('should overwrite with force flag', async () => {
      const install = new InstallCommand(testDir);

      // Install once
      await install.execute('typescript-lint');

      // Install again with force
      await install.execute('typescript-lint', { force: true });

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.hooks).toHaveLength(1); // Should still be 1, not 2
    });

    it('should fail when not initialized', async () => {
      // Remove config to simulate not initialized
      fs.rmSync(configPath);

      const install = new InstallCommand(testDir);
      await expect(install.execute('typescript-lint')).rejects.toThrow('not initialized');
    });
  });

  describe('UninstallCommand', () => {
    beforeEach(async () => {
      // Initialize and install a hook
      const init = new InitCommand(testDir);
      await init.execute({ force: true });

      const install = new InstallCommand(testDir);
      await install.execute('typescript-lint');
    });

    it('should uninstall a hook by name', async () => {
      const uninstall = new UninstallCommand(testDir);
      await uninstall.execute('typescript-lint');

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.hooks).toHaveLength(0);
    });

    it('should fail for non-existent hook', async () => {
      const uninstall = new UninstallCommand(testDir);
      await expect(uninstall.execute('non-existent')).rejects.toThrow('not found');
    });

    it('should handle empty hook list', async () => {
      // Remove all hooks first
      const config = { hooks: [] };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const consoleLog = jest.spyOn(console, 'log').mockImplementation();

      const uninstall = new UninstallCommand(testDir);
      await uninstall.execute();

      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('No hooks to uninstall'));

      consoleLog.mockRestore();
    });
  });

  describe('ShowCommand', () => {
    it('should show configured hooks', async () => {
      // Initialize and install hooks
      const init = new InitCommand(testDir);
      await init.execute({ force: true });

      const install = new InstallCommand(testDir);
      await install.execute('typescript-lint');
      await install.execute('python-lint');

      const consoleLog = jest.spyOn(console, 'log').mockImplementation();

      const show = new ShowCommand(testDir);
      await show.execute();

      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('2 hooks configured'));
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('typescript-lint'));
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('python-lint'));

      consoleLog.mockRestore();
    });

    it('should show message when no hooks configured', async () => {
      const init = new InitCommand(testDir);
      await init.execute({ force: true });

      const consoleLog = jest.spyOn(console, 'log').mockImplementation();

      const show = new ShowCommand(testDir);
      await show.execute();

      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('No hooks configured'));

      consoleLog.mockRestore();
    });

    it('should show verbose details with flag', async () => {
      const init = new InitCommand(testDir);
      await init.execute({ force: true });

      const install = new InstallCommand(testDir);
      await install.execute('typescript-lint');

      const consoleLog = jest.spyOn(console, 'log').mockImplementation();

      const show = new ShowCommand(testDir);
      await show.execute({ verbose: true });

      // Should show command details
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Command:'));

      consoleLog.mockRestore();
    });
  });

  describe('MigrateCommand', () => {
    it('should migrate vanilla hooks to cc-hooks', async () => {
      // First initialize to get orchestrator
      const init = new InitCommand(testDir);
      await init.execute({ force: true });

      // Then add vanilla hooks alongside orchestrator
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

      // Add vanilla hooks to existing orchestrator hooks
      settings.hooks.Stop[0].hooks.push({
        type: 'command',
        command: 'npm test',
      });

      settings.hooks.PreToolUse[0].hooks.push({
        type: 'command',
        command: 'eslint',
      });

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      // Migrate
      const migrate = new MigrateCommand(testDir);
      await migrate.execute();

      // Check hooks were migrated to config
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.hooks).toHaveLength(2);

      // Check vanilla hooks were removed from settings
      const finalSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const vanillaHooks = Object.values(finalSettings.hooks || {}).flatMap((eventHooks: any) =>
        eventHooks.flatMap((matcher: any) =>
          (matcher.hooks || []).filter((hook: any) => hook.command !== 'cc-hooks run'),
        ),
      );
      expect(vanillaHooks).toHaveLength(0);
    });

    it('should handle no vanilla hooks', async () => {
      // Initialize with no vanilla hooks
      const init = new InitCommand(testDir);
      await init.execute({ force: true });

      const consoleLog = jest.spyOn(console, 'log').mockImplementation();

      const migrate = new MigrateCommand(testDir);
      await migrate.execute();

      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('No vanilla hooks found'));

      consoleLog.mockRestore();
    });

    it('should not migrate already migrated hooks', async () => {
      // Initialize first
      const init = new InitCommand(testDir);
      await init.execute({ force: true });

      // Add vanilla hook alongside orchestrator
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      settings.hooks.Stop[0].hooks.push({
        type: 'command',
        command: 'npm test',
      });
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      // Migrate once
      const migrate = new MigrateCommand(testDir);
      await migrate.execute();

      // Check that the vanilla hook was removed from settings
      const cleanedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const vanillaHooks = cleanedSettings.hooks.Stop[0].hooks.filter(
        (h: any) => h.command !== 'cc-hooks run',
      );
      expect(vanillaHooks).toHaveLength(0);

      // Check that hook was added to cc-hooks.json
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.hooks).toHaveLength(1);
      expect(config.hooks[0].command).toEqual(['npm', 'test']);

      // Running migrate again should find no vanilla hooks
      const consoleLog = jest.spyOn(console, 'log').mockImplementation();
      await migrate.execute();

      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('No vanilla hooks found'));

      consoleLog.mockRestore();
    });
  });
});
