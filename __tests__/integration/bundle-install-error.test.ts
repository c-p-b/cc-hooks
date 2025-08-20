import { InstallCommand } from '../../src/commands/install';
import { CCHooksError } from '../../src/common/errors';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Bundle Installation Error Handling', () => {
  let tempDir: string;
  let originalCwd: string;
  let templatesDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hooks-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    
    // Create minimal config
    fs.mkdirSync(path.join(tempDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.claude', 'cc-hooks.json'),
      JSON.stringify({ hooks: [] }, null, 2)
    );

    // Create a test bundle with one invalid hook
    templatesDir = path.join(tempDir, 'test-templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    
    const badBundleDir = path.join(templatesDir, 'bad-bundle');
    fs.mkdirSync(badBundleDir);
    
    // Valid hook
    fs.writeFileSync(
      path.join(badBundleDir, 'valid.json'),
      JSON.stringify({
        name: 'valid-hook',
        events: ['Stop'],
        outputFormat: 'text',
        command: ['echo', 'test'],
        exitCodeMap: { '0': 'success' },
        message: 'Valid'
      }, null, 2)
    );
    
    // Invalid hook (missing required fields)
    fs.writeFileSync(
      path.join(badBundleDir, 'invalid.json'),
      JSON.stringify({
        name: 'invalid-hook',
        // Missing required 'events' field
        outputFormat: 'text',
        command: ['echo', 'test']
      }, null, 2)
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should fail entire bundle installation if any hook is invalid', async () => {
    // Create installCommand with mocked template path
    const installCommand = new InstallCommand(tempDir);
    
    // Override the private loadBuiltInTemplate method to use our test templates
    (installCommand as any).loadBuiltInTemplate = function(name: string) {
      const templatePath = path.join(templatesDir, name);
      if (!fs.existsSync(templatePath)) return null;
      
      // Use the actual implementation for loading bundle
      const stat = fs.statSync(templatePath);
      if (stat.isDirectory()) {
        const hookFiles = fs.readdirSync(templatePath)
          .filter(f => f.endsWith('.json'))
          .sort();
          
        const hooks: any[] = [];
        for (const file of hookFiles) {
          try {
            const content = fs.readFileSync(path.join(templatePath, file), 'utf-8');
            const hookDef = JSON.parse(content);
            
            if (!hookDef.name.startsWith(`${name}:`)) {
              hookDef.name = `${name}:${hookDef.name}`;
            }
            
            hooks.push(this.validateHookDefinition(hookDef));
          } catch (error) {
            throw new CCHooksError(`Failed to load hook from ${file} in bundle ${name}: ${error}`);
          }
        }
        return hooks;
      }
      return null;
    };

    // Should throw when trying to install bundle with invalid hook
    await expect(installCommand.execute('bad-bundle')).rejects.toThrow(CCHooksError);
    await expect(installCommand.execute('bad-bundle')).rejects.toThrow(/Failed to load hook from invalid.json/);

    // Config should remain unchanged (no hooks installed)
    const configPath = path.join(tempDir, '.claude', 'cc-hooks.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.hooks.length).toBe(0);
  });

  it('should fail with clear error for malformed JSON in bundle', async () => {
    const badJsonBundle = path.join(templatesDir, 'json-error');
    fs.mkdirSync(badJsonBundle);
    
    // Write malformed JSON
    fs.writeFileSync(
      path.join(badJsonBundle, 'broken.json'),
      '{ "name": "broken", invalid json here }'
    );

    const installCommand = new InstallCommand(tempDir);
    
    // Override the private loadBuiltInTemplate method  
    (installCommand as any).loadBuiltInTemplate = function(name: string) {
      const templatePath = path.join(templatesDir, name);
      if (!fs.existsSync(templatePath)) return null;
      
      const stat = fs.statSync(templatePath);
      if (stat.isDirectory()) {
        const hookFiles = fs.readdirSync(templatePath)
          .filter(f => f.endsWith('.json'))
          .sort();
          
        const hooks: any[] = [];
        for (const file of hookFiles) {
          try {
            const content = fs.readFileSync(path.join(templatePath, file), 'utf-8');
            const hookDef = JSON.parse(content);
            
            if (!hookDef.name.startsWith(`${name}:`)) {
              hookDef.name = `${name}:${hookDef.name}`;
            }
            
            hooks.push(this.validateHookDefinition(hookDef));
          } catch (error) {
            throw new CCHooksError(`Failed to load hook from ${file} in bundle ${name}: ${error}`);
          }
        }
        return hooks;
      }
      return null;
    };

    await expect(installCommand.execute('json-error')).rejects.toThrow(CCHooksError);
    await expect(installCommand.execute('json-error')).rejects.toThrow(/Failed to load hook from broken.json/);
  });
});