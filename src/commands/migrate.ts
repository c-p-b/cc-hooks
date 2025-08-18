import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { CCHooksError } from '../common/errors';
import { getLogger } from '../common/logger';
import { HooksConfigFile, TextHook, ClaudeEventName } from '../common/types';
import { ConfigLoader } from '../orchestrator/config-loader';

export interface MigrateOptions {
  interactive?: boolean;
}

export class MigrateCommand {
  private logger = getLogger();
  private configLoader = new ConfigLoader();
  
  private readonly CLAUDE_EVENTS: ClaudeEventName[] = [
    'PreToolUse',
    'PostToolUse',
    'Stop',
    'UserPromptSubmit',
    'Notification',
    'SubagentStop',
    'PreCompact',
    'SessionStart'
  ];

  async execute(options: MigrateOptions = {}): Promise<void> {
    try {
      // Find settings.json
      const settingsPath = this.findSettingsFile();
      if (!settingsPath) {
        throw new CCHooksError('No Claude settings.json found');
      }

      // Load settings
      const settings = this.loadSettings(settingsPath);
      
      // Find vanilla hooks
      const vanillaHooks = this.extractVanillaHooks(settings);
      
      if (vanillaHooks.length === 0) {
        console.log(chalk.yellow('No vanilla hooks found to migrate'));
        return;
      }

      console.log(chalk.bold(`Found ${vanillaHooks.length} vanilla hook${vanillaHooks.length === 1 ? '' : 's'} to migrate:`));
      console.log();
      
      for (const hook of vanillaHooks) {
        console.log(chalk.cyan(`• ${hook.event}: ${hook.command}`));
      }
      console.log();

      // Confirm migration
      if (options.interactive) {
        const proceed = await this.confirmMigration();
        if (!proceed) {
          console.log(chalk.gray('Migration cancelled'));
          return;
        }
      }

      // Load or create cc-hooks config
      const configPath = this.getConfigPath(settingsPath);
      const config = fs.existsSync(configPath) 
        ? this.configLoader.load(configPath)
        : { hooks: [] };

      // Convert vanilla hooks to cc-hooks format
      const convertedHooks = this.convertHooks(vanillaHooks);
      
      // Add to config (checking for duplicates)
      let added = 0;
      let skipped = 0;
      
      for (const hook of convertedHooks) {
        const existing = config.hooks.find(h => h.name === hook.name);
        if (existing) {
          console.log(chalk.yellow(`⚠ Skipping duplicate: ${hook.name}`));
          skipped++;
        } else {
          config.hooks.push(hook);
          added++;
        }
      }

      // Save cc-hooks config
      await this.saveConfig(configPath, config);
      
      // Backup settings before removing vanilla hooks
      await this.backupSettings(settingsPath);
      
      // Remove vanilla hooks from settings
      const cleanedSettings = this.removeVanillaHooks(settings);
      await this.writeSettings(settingsPath, cleanedSettings);
      
      // Report results
      console.log();
      console.log(chalk.green(`✓ Migration completed`));
      console.log(chalk.gray(`  Migrated: ${added} hooks`));
      if (skipped > 0) {
        console.log(chalk.gray(`  Skipped: ${skipped} duplicates`));
      }
      console.log(chalk.gray(`  Config: ${configPath}`));
      console.log();
      console.log(chalk.gray('Vanilla hooks have been removed from settings.json'));
      console.log(chalk.gray('Run "cc-hooks show" to view migrated hooks'));
      
    } catch (error) {
      if (error instanceof CCHooksError) {
        throw error;
      }
      throw new CCHooksError(`Migration failed: ${error}`);
    }
  }

  private findSettingsFile(): string | null {
    const locations = [
      path.join(process.cwd(), '.claude', 'settings.json'),
      path.join(process.cwd(), 'settings.json'),
      path.join(process.env.HOME || '', '.claude', 'settings.json')
    ];

    for (const location of locations) {
      if (fs.existsSync(location)) {
        return location;
      }
    }

    return null;
  }

  private getConfigPath(settingsPath: string): string {
    const dir = path.dirname(settingsPath);
    return path.join(dir, 'cc-hooks.json');
  }

  private loadSettings(settingsPath: string): any {
    try {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      throw new CCHooksError(`Failed to load settings.json: ${error}`);
    }
  }

  private extractVanillaHooks(settings: any): Array<{event: ClaudeEventName, command: string, matcher?: string}> {
    const hooks: Array<{event: ClaudeEventName, command: string, matcher?: string}> = [];
    
    if (!settings.hooks) return hooks;
    
    for (const event of this.CLAUDE_EVENTS) {
      const eventHooks = settings.hooks[event];
      if (Array.isArray(eventHooks)) {
        for (const matcher of eventHooks) {
          if (Array.isArray(matcher.hooks)) {
            for (const hook of matcher.hooks) {
              // Skip cc-hooks orchestrator
              if (hook.command && hook.command !== 'cc-hooks run') {
                hooks.push({
                  event: event,
                  command: hook.command,
                  matcher: matcher.matcher
                });
              }
            }
          }
        }
      }
    }
    
    return hooks;
  }

  private convertHooks(vanillaHooks: Array<{event: ClaudeEventName, command: string, matcher?: string}>): TextHook[] {
    const converted: TextHook[] = [];
    
    for (const vanilla of vanillaHooks) {
      // Generate a name from the command
      const name = this.generateHookName(vanilla.command);
      
      // Parse command into array
      const commandArray = this.parseCommand(vanilla.command);
      
      // Create text hook with sensible defaults
      const hook: TextHook = {
        name,
        description: `Migrated from vanilla hook: ${vanilla.command}`,
        command: commandArray,
        events: [vanilla.event],
        outputFormat: 'text',
        exitCodeMap: {
          '0': 'success',
          'default': 'non-blocking-error'
        },
        message: `Hook '${name}' failed`,
        timeout: 30000
      };
      
      // Add matcher only if present
      if (vanilla.matcher !== undefined) {
        (hook as any).matcher = vanilla.matcher;
      }
      
      converted.push(hook);
    }
    
    return converted;
  }

  private generateHookName(command: string): string {
    // Extract a reasonable name from the command
    const parts = command.split(/\s+/);
    const firstPart = parts[0] || 'hook';
    const executable = path.basename(firstPart);
    
    // Remove common prefixes
    let name = executable.replace(/^(npx|npm|yarn|pnpm|node|python|python3|ruby|sh|bash)$/, '');
    
    // If we removed everything, use the second part
    if (!name && parts.length > 1) {
      name = parts[1] || 'hook';
    }
    
    // Clean up and make valid
    name = name.replace(/[^a-zA-Z0-9-_]/g, '-');
    
    // Add timestamp to ensure uniqueness
    return `${name || 'hook'}-${Date.now()}`;
  }

  private parseCommand(command: string): string[] {
    // Simple command parsing - handles basic cases
    // For complex commands with pipes, quotes, etc., this may need refinement
    const parts: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    
    for (let i = 0; i < command.length; i++) {
      const char = command[i];
      
      if (inQuote) {
        if (char === quoteChar && command[i-1] !== '\\') {
          inQuote = false;
          quoteChar = '';
        } else {
          current += char;
        }
      } else {
        if (char === '"' || char === "'") {
          inQuote = true;
          quoteChar = char;
        } else if (char === ' ' || char === '\t') {
          if (current) {
            parts.push(current);
            current = '';
          }
        } else {
          current += char;
        }
      }
    }
    
    if (current) {
      parts.push(current);
    }
    
    return parts.length > 0 ? parts : [command];
  }

  private removeVanillaHooks(settings: any): any {
    if (!settings.hooks) return settings;

    // Remove all non-cc-hooks entries
    for (const event of this.CLAUDE_EVENTS) {
      const eventHooks = settings.hooks[event];
      if (Array.isArray(eventHooks)) {
        for (const matcher of eventHooks) {
          if (Array.isArray(matcher.hooks)) {
            // Keep only cc-hooks orchestrator
            matcher.hooks = matcher.hooks.filter((hook: any) => 
              hook.command === 'cc-hooks run'
            );
          }
        }
      }
    }

    return settings;
  }

  private async confirmMigration(): Promise<boolean> {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      readline.question(chalk.gray('Proceed with migration? (y/n): '), (answer: string) => {
        readline.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }

  private async backupSettings(settingsPath: string): Promise<void> {
    const backupPath = `${settingsPath}.backup-${Date.now()}`;
    await fs.promises.copyFile(settingsPath, backupPath);
    this.logger.log(`Backed up settings to: ${backupPath}`);
  }

  private async writeSettings(settingsPath: string, settings: any): Promise<void> {
    const content = JSON.stringify(settings, null, 2);
    await fs.promises.writeFile(settingsPath, content, 'utf-8');
    this.logger.log(`Updated settings at: ${settingsPath}`);
  }

  private async saveConfig(configPath: string, config: HooksConfigFile): Promise<void> {
    const content = JSON.stringify(config, null, 2);
    await fs.promises.writeFile(configPath, content, 'utf-8');
    this.logger.log(`Saved config at: ${configPath}`);
  }
}