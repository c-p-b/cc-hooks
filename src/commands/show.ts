import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { CCHooksError } from '../common/errors';
import { ConfigLoader } from '../orchestrator/config-loader';

export interface ShowOptions {
  verbose?: boolean;
}

export class ShowCommand {
  private configLoader = new ConfigLoader();
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  async execute(options: ShowOptions = {}): Promise<void> {
    try {
      // Find config file
      const configPath = this.findConfigFile();
      if (!configPath) {
        console.log(chalk.yellow('⚠ cc-hooks is not initialized'));
        console.log(chalk.gray('Run "cc-hooks init" to get started'));
        return;
      }

      // Load config
      const config = this.configLoader.load(configPath);

      // Show config location
      console.log(chalk.gray(`Configuration: ${configPath}`));
      console.log();

      // Check if any hooks configured
      if (config.hooks.length === 0) {
        console.log(chalk.yellow('No hooks configured'));
        console.log(chalk.gray('Run "cc-hooks install <template>" to add hooks'));
        return;
      }

      // Display hooks
      console.log(
        chalk.bold(
          `${config.hooks.length} hook${config.hooks.length === 1 ? '' : 's'} configured:`,
        ),
      );
      console.log();

      for (const hook of config.hooks) {
        // Hook name and description
        console.log(chalk.cyan(`• ${hook.name}`));
        if (hook.description) {
          console.log(chalk.gray(`  ${hook.description}`));
        }

        // Basic info
        console.log(chalk.gray(`  Events: ${hook.events.join(', ')}`));
        console.log(chalk.gray(`  Type: ${hook.outputFormat}`));

        if (options.verbose) {
          // Command
          console.log(chalk.gray(`  Command: ${hook.command.join(' ')}`));

          // Priority
          if (hook.priority !== undefined) {
            console.log(chalk.gray(`  Priority: ${hook.priority}`));
          }

          // Timeout
          if (hook.timeout !== undefined) {
            console.log(chalk.gray(`  Timeout: ${hook.timeout}ms`));
          }

          // Matcher (for tool hooks)
          if (hook.matcher !== undefined) {
            console.log(chalk.gray(`  Matcher: ${hook.matcher}`));
          }

          // Text hook specific
          if (hook.outputFormat === 'text') {
            console.log(chalk.gray(`  Message: ${hook.message}`));
            if (hook.exitCodeMap) {
              const codes = Object.entries(hook.exitCodeMap)
                .map(([code, action]) => `${code}=${action}`)
                .join(', ');
              console.log(chalk.gray(`  Exit codes: ${codes}`));
            }
            if (hook.fixInstructions) {
              console.log(chalk.gray(`  Fix: ${hook.fixInstructions}`));
            }
          }
        }

        console.log();
      }

      // Show logging config if present
      if (config.logging && options.verbose) {
        console.log(chalk.bold('Logging:'));
        console.log(chalk.gray(`  Level: ${config.logging.level}`));
        if (config.logging.path) {
          console.log(chalk.gray(`  Path: ${config.logging.path}`));
        }
        console.log();
      }

      // Footer hints
      if (!options.verbose) {
        console.log(chalk.gray('Use --verbose for more details'));
      }
    } catch (error) {
      if (error instanceof CCHooksError) {
        throw error;
      }
      throw new CCHooksError(`Failed to show hooks: ${error}`);
    }
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
}
