import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { CCHooksError } from '../common/errors';
import { getLogger } from '../common/logger';
import { HooksConfigFile, HookDefinition } from '../common/types';
import { ConfigLoader } from '../orchestrator/config-loader';

export interface InstallOptions {
  force?: boolean;
}

export class InstallCommand {
  private logger = getLogger();
  private configLoader = new ConfigLoader();
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  async execute(source: string, options: InstallOptions = {}): Promise<void> {
    try {
      // Check if cc-hooks is initialized
      const configPath = this.findConfigFile();
      if (!configPath) {
        throw new CCHooksError('cc-hooks is not initialized. Run "cc-hooks init" first.');
      }

      // Resolve the hook source (can be single hook or array of hooks)
      const result = await this.resolveHookSource(source);
      const hooksToInstall = Array.isArray(result) ? result : [result];

      // Load existing config
      const config = this.configLoader.load(configPath);

      let installedCount = 0;
      let replacedCount = 0;

      // Install each hook
      for (const hookDef of hooksToInstall) {
        // Check for conflicts
        const existingHook = config.hooks.find((h) => h.name === hookDef.name);
        if (existingHook && !options.force) {
          if (hooksToInstall.length === 1) {
            // Single hook install - throw error as before
            throw new CCHooksError(`Hook '${hookDef.name}' already exists. Use --force to overwrite.`);
          }
          // Bundle install - silently overwrite
          // When installing a bundle, users expect the full bundle
        }

        // Add or replace the hook
        if (existingHook) {
          const index = config.hooks.findIndex((h) => h.name === hookDef.name);
          config.hooks[index] = hookDef;
          replacedCount++;
        } else {
          config.hooks.push(hookDef);
          installedCount++;
        }
      }

      // Save updated config
      await this.saveConfig(configPath, config);

      // Show results
      if (hooksToInstall.length === 1) {
        // Single hook - detailed output as before
        const hookDef = hooksToInstall[0];
        if (hookDef) {
          if (replacedCount > 0) {
            console.log(chalk.yellow(`⚠ Replaced existing hook: ${hookDef.name}`));
          } else {
            console.log(chalk.green(`✓ Installed hook: ${hookDef.name}`));
          }
          console.log(chalk.gray(`  Description: ${hookDef.description || 'N/A'}`));
          console.log(chalk.gray(`  Events: ${hookDef.events.join(', ')}`));
          console.log(chalk.gray(`  Command: ${hookDef.command.join(' ')}`));
        }
      } else {
        // Bundle - summary output
        console.log(chalk.green(`✓ Installed ${installedCount} hooks from ${source}`));
        if (replacedCount > 0) {
          console.log(chalk.yellow(`⚠ Replaced ${replacedCount} existing hooks`));
        }
        console.log(chalk.gray(`\nRun 'cc-hooks show' to see all installed hooks`));
      }
    } catch (error) {
      if (error instanceof CCHooksError) {
        throw error;
      }
      throw new CCHooksError(`Failed to install hook: ${error}`);
    }
  }

  private async resolveHookSource(source: string): Promise<HookDefinition | HookDefinition[]> {
    // 1. Check if it's a built-in template
    const builtInHook = await this.loadBuiltInTemplate(source);
    if (builtInHook) {
      return builtInHook;
    }

    // 2. Check if it's a local path
    if (source.startsWith('./') || source.startsWith('/') || source.startsWith('../')) {
      return await this.loadLocalHook(source);
    }

    // 3. Check if it's a git URL
    if (this.isGitUrl(source)) {
      return await this.loadGitHook(source);
    }

    throw new CCHooksError(
      `Unable to resolve hook source: ${source}\n` +
        `Try one of:\n` +
        `  - Built-in template name (e.g., typescript-lint)\n` +
        `  - Built-in bundle name (e.g., typescript)\n` +
        `  - Local path (e.g., ./my-hook.json)\n` +
        `  - Git URL (e.g., https://github.com/user/repo)`,
    );
  }

  private async loadBuiltInTemplate(name: string): Promise<HookDefinition | HookDefinition[] | null> {
    try {
      const templatesDir = path.join(__dirname, '..', '..', 'templates');
      
      // First check if it's a directory (bundle)
      const bundlePath = path.join(templatesDir, name);
      if (fs.existsSync(bundlePath) && fs.statSync(bundlePath).isDirectory()) {
        // Load all .json files from the directory
        const hookFiles = fs.readdirSync(bundlePath)
          .filter(f => f.endsWith('.json'))
          .sort(); // Sort for consistent ordering
        
        if (hookFiles.length === 0) {
          return null;
        }
        
        const hooks: HookDefinition[] = [];
        for (const file of hookFiles) {
          try {
            const content = fs.readFileSync(path.join(bundlePath, file), 'utf-8');
            const hookDef = JSON.parse(content);
            
            // Prefix hook name with bundle name to avoid collisions
            if (!hookDef.name.startsWith(`${name}:`)) {
              hookDef.name = `${name}:${hookDef.name}`;
            }
            
            hooks.push(this.validateHookDefinition(hookDef));
          } catch (error) {
            // Fail the entire bundle installation if any hook is invalid
            throw new CCHooksError(`Failed to load hook from ${file} in bundle ${name}: ${error}`);
          }
        }
        
        return hooks;
      }
      
      // Otherwise try as single template file
      let templatePath = path.join(templatesDir, `${name}.json`);

      if (!fs.existsSync(templatePath)) {
        // Try without .json extension if name already has it
        const altPath = path.join(templatesDir, name);
        if (fs.existsSync(altPath)) {
          templatePath = altPath;
        } else {
          return null;
        }
      }

      const content = fs.readFileSync(templatePath, 'utf-8');
      const hookDef = JSON.parse(content);

      // Validate the hook definition
      return this.validateHookDefinition(hookDef);
    } catch (error) {
      this.logger.log(`Failed to load built-in template ${name}: ${error}`);
      return null;
    }
  }

  private async loadLocalHook(hookPath: string): Promise<HookDefinition> {
    const resolvedPath = path.resolve(hookPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new CCHooksError(`Hook file not found: ${resolvedPath}`);
    }

    const stat = fs.statSync(resolvedPath);

    if (stat.isDirectory()) {
      // Look for hook.json in the directory
      const hookFile = path.join(resolvedPath, 'hook.json');
      if (!fs.existsSync(hookFile)) {
        throw new CCHooksError(`No hook.json found in directory: ${resolvedPath}`);
      }
      return this.loadHookFile(hookFile);
    } else {
      // Load the file directly
      return this.loadHookFile(resolvedPath);
    }
  }

  private async loadGitHook(gitUrl: string): Promise<HookDefinition> {
    console.log(chalk.gray(`Cloning from ${gitUrl}...`));

    // Create temp directory
    const tempDir = path.join(process.env.TMPDIR || '/tmp', `cc-hooks-${Date.now()}`);

    try {
      // Clone the repository
      execSync(`git clone --depth 1 --quiet "${gitUrl}" "${tempDir}"`, {
        stdio: 'pipe',
      });

      // Look for hook.json or hooks/ directory
      const hookFile = path.join(tempDir, 'hook.json');
      const hooksDir = path.join(tempDir, 'hooks');

      if (fs.existsSync(hookFile)) {
        // Single hook repository
        return this.loadHookFile(hookFile);
      } else if (fs.existsSync(hooksDir)) {
        // Multiple hooks repository - list available hooks
        const hooks = fs
          .readdirSync(hooksDir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.replace('.json', ''));

        throw new CCHooksError(
          `Multiple hooks found in repository. Install specific hook:\n` +
            hooks.map((h) => `  cc-hooks install ${gitUrl}#${h}`).join('\n'),
        );
      } else {
        throw new CCHooksError(`No hook.json or hooks/ directory found in repository: ${gitUrl}`);
      }
    } finally {
      // Clean up temp directory
      if (fs.existsSync(tempDir)) {
        execSync(`rm -rf "${tempDir}"`, { stdio: 'pipe' });
      }
    }
  }

  private loadHookFile(filePath: string): HookDefinition {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const hookDef = JSON.parse(content);
      return this.validateHookDefinition(hookDef);
    } catch (error) {
      throw new CCHooksError(`Failed to load hook file ${filePath}: ${error}`);
    }
  }

  private validateHookDefinition(hook: any): HookDefinition {
    // Basic validation - the ConfigLoader will do full validation
    if (!hook.name || typeof hook.name !== 'string') {
      throw new CCHooksError('Hook must have a name');
    }
    if (!Array.isArray(hook.command) || hook.command.length === 0) {
      throw new CCHooksError('Hook must have a command array');
    }
    if (!Array.isArray(hook.events) || hook.events.length === 0) {
      throw new CCHooksError('Hook must have events array');
    }
    if (!hook.outputFormat) {
      throw new CCHooksError('Hook must have outputFormat (text or structured)');
    }

    // For text hooks, ensure required fields
    if (hook.outputFormat === 'text') {
      if (!hook.exitCodeMap) {
        throw new CCHooksError('Text hooks must have exitCodeMap');
      }
      if (!hook.message) {
        throw new CCHooksError('Text hooks must have a message');
      }
    }

    return hook as HookDefinition;
  }

  private isGitUrl(source: string): boolean {
    return (
      source.startsWith('https://') ||
      source.startsWith('git://') ||
      source.startsWith('git@') ||
      source.includes('github.com') ||
      source.includes('gitlab.com')
    );
  }

  private findConfigFile(): string | null {
    const locations = [
      path.join(this.cwd, '.claude', 'cc-hooks-local.json'),
      path.join(this.cwd, '.claude', 'cc-hooks.json'),
      path.join(this.cwd, 'cc-hooks.json'),
      path.join(process.env.HOME || '', '.claude', 'cc-hooks.json'),
    ];

    for (const location of locations) {
      if (fs.existsSync(location)) {
        return location;
      }
    }

    return null;
  }

  private async saveConfig(configPath: string, config: HooksConfigFile): Promise<void> {
    const content = JSON.stringify(config, null, 2);
    await fs.promises.writeFile(configPath, content, 'utf-8');
    this.logger.log(`Updated config at: ${configPath}`);
  }
}
