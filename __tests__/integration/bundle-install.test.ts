import { InstallCommand } from '../../src/commands/install';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Bundle Installation - Integration', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create real temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hooks-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    
    // Create minimal config directly instead of using InitCommand
    // (InitCommand would find global config)
    fs.mkdirSync(path.join(tempDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.claude', 'cc-hooks.json'),
      JSON.stringify({ hooks: [] }, null, 2)
    );
  });

  afterEach(() => {
    // Clean up
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should install typescript bundle with namespaced hooks', async () => {
    const installCommand = new InstallCommand(tempDir);
    
    // Install the typescript bundle
    await installCommand.execute('typescript');
    
    // Read the actual config file that was created
    const configPath = path.join(tempDir, '.claude', 'cc-hooks.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // Should have multiple hooks, all namespaced
    expect(config.hooks.length).toBeGreaterThan(1);
    expect(config.hooks.every((h: any) => h.name.startsWith('typescript:'))).toBe(true);
    
    // Check specific hooks exist
    const hookNames = config.hooks.map((h: any) => h.name);
    expect(hookNames).toContain('typescript:eslint-autofix');
    expect(hookNames).toContain('typescript:prettier-format');
  });

  it('should overwrite existing hooks in bundle mode without --force', async () => {
    const installCommand = new InstallCommand(tempDir);
    
    // Install once
    await installCommand.execute('typescript');
    
    // Modify a hook to check it gets replaced
    const configPath = path.join(tempDir, '.claude', 'cc-hooks.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const originalDescription = config.hooks[0].description;
    config.hooks[0].description = 'MODIFIED';
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    // Install again without --force (bundles should overwrite)
    await installCommand.execute('typescript');
    
    // Check hook was replaced
    const newConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(newConfig.hooks[0].description).toBe(originalDescription);
    expect(newConfig.hooks[0].description).not.toBe('MODIFIED');
  });

  it('should replace hooks with --force', async () => {
    const installCommand = new InstallCommand(tempDir);
    
    // Install once
    await installCommand.execute('typescript');
    
    // Modify a hook to check it gets replaced
    const configPath = path.join(tempDir, '.claude', 'cc-hooks.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.hooks[0].description = 'MODIFIED';
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    // Install again with force
    await installCommand.execute('typescript', { force: true });
    
    // Check hook was replaced
    const newConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(newConfig.hooks[0].description).not.toBe('MODIFIED');
  });
});