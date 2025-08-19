import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { CCHooksError } from '../common/errors';
import { getLogger } from '../common/logger';
import { ClaudeEventName, HooksConfigFile } from '../common/types';

export interface InitOptions {
  force?: boolean;
}

export class InitCommand {
  private logger = getLogger();
  private cwd: string;

  // All Claude events that we need to register
  private readonly CLAUDE_EVENTS: ClaudeEventName[] = [
    'PreToolUse',
    'PostToolUse',
    'Stop',
    'UserPromptSubmit',
    'Notification',
    'SubagentStop',
    'PreCompact',
    'SessionStart',
  ];

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  async execute(options: InitOptions = {}): Promise<void> {
    try {
      // Find settings.json (check all three tiers)
      const settingsPath = this.findSettingsFile();

      if (!settingsPath && !options.force) {
        throw new CCHooksError(
          'No Claude settings.json found. Run with --force to create one, or create .claude/settings.json first.',
        );
      }

      // Create or load settings
      const settings = settingsPath ? this.loadSettings(settingsPath) : {};
      const targetPath = settingsPath || this.getDefaultSettingsPath();

      // Check if already initialized
      if (!options.force && this.isAlreadyInitialized(settings)) {
        console.log(chalk.yellow('⚠ cc-hooks is already initialized'));
        console.log(chalk.gray('Run with --force to reinitialize'));
        return;
      }

      // Backup existing settings if they exist
      if (settingsPath && Object.keys(settings).length > 0) {
        await this.backupSettings(settingsPath);
      }

      // Check for existing vanilla hooks
      const existingHooks = this.detectVanillaHooks(settings);
      if (existingHooks.length > 0) {
        console.log(chalk.yellow(`⚠ Found ${existingHooks.length} existing vanilla hooks`));
        console.log(chalk.gray('Run "cc-hooks migrate" after initialization to convert them'));
      }

      // Add orchestrator entries for all events
      const updatedSettings = this.addOrchestratorHooks(settings);

      // Write updated settings
      await this.writeSettings(targetPath, updatedSettings);

      // Create cc-hooks.json if it doesn't exist
      const configPath = this.getConfigPath();
      if (!fs.existsSync(configPath)) {
        await this.createEmptyConfig(configPath);
      }

      // Success message
      console.log(chalk.green('✓ cc-hooks initialized successfully'));
      console.log(chalk.gray(`  Settings: ${targetPath}`));
      console.log(chalk.gray(`  Config: ${configPath}`));

      if (existingHooks.length > 0) {
        console.log();
        console.log(chalk.yellow('Next step: Run "cc-hooks migrate" to convert existing hooks'));
      } else {
        console.log();
        console.log(chalk.gray('Next step: Run "cc-hooks install <template>" to add hooks'));
      }
    } catch (error) {
      if (error instanceof CCHooksError) {
        throw error;
      }
      throw new CCHooksError(`Failed to initialize: ${error}`);
    }
  }

  private findSettingsFile(): string | null {
    // Check in priority order: local > project > global
    const locations = [
      path.join(this.cwd, '.claude', 'settings.json'),
      path.join(this.cwd, 'settings.json'),
      path.join(process.env.HOME || '', '.claude', 'settings.json'),
    ];

    for (const location of locations) {
      if (fs.existsSync(location)) {
        this.logger.log(`Found settings.json at: ${location}`);
        return location;
      }
    }

    return null;
  }

  private getDefaultSettingsPath(): string {
    // Default to project-level .claude/settings.json
    return path.join(this.cwd, '.claude', 'settings.json');
  }

  private getConfigPath(): string {
    // cc-hooks.json goes in the same directory as settings.json
    const settingsPath = this.findSettingsFile() || this.getDefaultSettingsPath();
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

  private isAlreadyInitialized(settings: any): boolean {
    if (!settings.hooks) return false;

    // Check if orchestrator is already present for any event
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

  private detectVanillaHooks(settings: any): string[] {
    const vanillaHooks: string[] = [];

    if (!settings.hooks) return vanillaHooks;

    for (const event of this.CLAUDE_EVENTS) {
      const eventHooks = settings.hooks[event];
      if (Array.isArray(eventHooks)) {
        for (const matcher of eventHooks) {
          if (Array.isArray(matcher.hooks)) {
            for (const hook of matcher.hooks) {
              // Any hook that's not cc-hooks is vanilla
              if (hook.command && hook.command !== 'cc-hooks run') {
                vanillaHooks.push(`${event}: ${hook.command}`);
              }
            }
          }
        }
      }
    }

    return vanillaHooks;
  }

  private addOrchestratorHooks(settings: any): any {
    // Initialize hooks object if it doesn't exist
    if (!settings.hooks) {
      settings.hooks = {};
    }

    // Add orchestrator for each event type
    for (const event of this.CLAUDE_EVENTS) {
      // Different events have different structures
      if (event === 'PreToolUse' || event === 'PostToolUse') {
        // These events support matchers
        settings.hooks[event] = [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: 'cc-hooks run',
              },
            ],
          },
        ];
      } else if (event === 'PreCompact' || event === 'SessionStart') {
        // These events have optional matchers/source
        settings.hooks[event] = [
          {
            hooks: [
              {
                type: 'command',
                command: 'cc-hooks run',
              },
            ],
          },
        ];
      } else {
        // Stop, UserPromptSubmit, Notification, SubagentStop
        settings.hooks[event] = [
          {
            hooks: [
              {
                type: 'command',
                command: 'cc-hooks run',
              },
            ],
          },
        ];
      }
    }

    return settings;
  }

  private async writeSettings(settingsPath: string, settings: any): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    // Write with pretty formatting
    const content = JSON.stringify(settings, null, 2);
    await fs.promises.writeFile(settingsPath, content, 'utf-8');
    this.logger.log(`Updated settings at: ${settingsPath}`);
  }

  private async createEmptyConfig(configPath: string): Promise<void> {
    const emptyConfig: HooksConfigFile = {
      hooks: [],
    };

    const content = JSON.stringify(emptyConfig, null, 2);
    await fs.promises.writeFile(configPath, content, 'utf-8');
    this.logger.log(`Created empty config at: ${configPath}`);
  }
}
