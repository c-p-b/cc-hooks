import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { CCHooksError } from '../common/errors';
import { getLogger } from '../common/logger';
import { ClaudeEventName } from '../common/types';

export class UninitCommand {
  private logger = getLogger();
  private cwd: string;
  
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

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  async execute(): Promise<void> {
    try {
      // Find settings.json
      const settingsPath = this.findSettingsFile();
      
      if (!settingsPath) {
        console.log(chalk.yellow('⚠ No Claude settings.json found'));
        console.log(chalk.gray('cc-hooks is not initialized'));
        return;
      }

      // Load settings
      const settings = this.loadSettings(settingsPath);
      
      // Check if cc-hooks is initialized
      if (!this.isInitialized(settings)) {
        console.log(chalk.yellow('⚠ cc-hooks is not initialized'));
        return;
      }

      // Backup before modification
      await this.backupSettings(settingsPath);

      // Remove orchestrator hooks
      const cleanedSettings = this.removeOrchestratorHooks(settings);
      
      // Write cleaned settings
      await this.writeSettings(settingsPath, cleanedSettings);
      
      // Remove cc-hooks.json
      const configPath = this.getConfigPath(settingsPath);
      if (fs.existsSync(configPath)) {
        await fs.promises.unlink(configPath);
        console.log(chalk.gray(`  Removed: ${configPath}`));
      }

      // Remove cc-hooks-local.json if it exists
      const localConfigPath = configPath.replace('cc-hooks.json', 'cc-hooks-local.json');
      if (fs.existsSync(localConfigPath)) {
        await fs.promises.unlink(localConfigPath);
        console.log(chalk.gray(`  Removed: ${localConfigPath}`));
      }

      console.log(chalk.green('✓ cc-hooks deactivated successfully'));
      console.log(chalk.gray('Run "cc-hooks init" to reactivate'));
      
    } catch (error) {
      if (error instanceof CCHooksError) {
        throw error;
      }
      throw new CCHooksError(`Failed to uninitialize: ${error}`);
    }
  }

  private findSettingsFile(): string | null {
    const locations = [
      path.join(this.cwd, '.claude', 'settings.json'),
      path.join(this.cwd, 'settings.json'),
      path.join(process.env.HOME || '', '.claude', 'settings.json')
    ];

    for (const location of locations) {
      if (fs.existsSync(location)) {
        this.logger.log(`Found settings.json at: ${location}`);
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

  private async backupSettings(settingsPath: string): Promise<void> {
    const backupPath = `${settingsPath}.backup-${Date.now()}`;
    await fs.promises.copyFile(settingsPath, backupPath);
    this.logger.log(`Backed up settings to: ${backupPath}`);
  }

  private isInitialized(settings: any): boolean {
    if (!settings.hooks) return false;
    
    for (const event of this.CLAUDE_EVENTS) {
      const eventHooks = settings.hooks[event];
      if (Array.isArray(eventHooks)) {
        for (const matcher of eventHooks) {
          if (Array.isArray(matcher.hooks)) {
            for (const hook of matcher.hooks) {
              if (hook.command === 'cc-hooks run') {
                return true;
              }
            }
          }
        }
      }
    }
    
    return false;
  }

  private removeOrchestratorHooks(settings: any): any {
    if (!settings.hooks) return settings;

    // Remove cc-hooks orchestrator from each event
    for (const event of this.CLAUDE_EVENTS) {
      const eventHooks = settings.hooks[event];
      if (Array.isArray(eventHooks)) {
        // Filter out matchers that only contain cc-hooks
        settings.hooks[event] = eventHooks.filter(matcher => {
          if (Array.isArray(matcher.hooks)) {
            // Remove cc-hooks from the hooks array
            matcher.hooks = matcher.hooks.filter((hook: any) => 
              hook.command !== 'cc-hooks run'
            );
            // Keep the matcher only if it has other hooks
            return matcher.hooks.length > 0;
          }
          return true;
        });
        
        // Remove the event entirely if no matchers left
        if (settings.hooks[event].length === 0) {
          delete settings.hooks[event];
        }
      }
    }

    // Remove hooks object if empty
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    return settings;
  }

  private async writeSettings(settingsPath: string, settings: any): Promise<void> {
    const content = JSON.stringify(settings, null, 2);
    await fs.promises.writeFile(settingsPath, content, 'utf-8');
    this.logger.log(`Updated settings at: ${settingsPath}`);
  }
}