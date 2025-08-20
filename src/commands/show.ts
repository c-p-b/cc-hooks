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

      // Group hooks by bundle
      const bundles = new Map<string, typeof config.hooks>();
      const standaloneHooks: typeof config.hooks = [];
      
      for (const hook of config.hooks) {
        const colonIndex = hook.name.indexOf(':');
        if (colonIndex > 0) {
          // This looks like a bundled hook (has prefix)
          const bundleName = hook.name.substring(0, colonIndex);
          if (!bundles.has(bundleName)) {
            bundles.set(bundleName, []);
          }
          bundles.get(bundleName)!.push(hook);
        } else {
          standaloneHooks.push(hook);
        }
      }

      // Display hooks
      console.log(
        chalk.bold(
          `${config.hooks.length} hook${config.hooks.length === 1 ? '' : 's'} configured:`,
        ),
      );
      console.log();

      // Show bundled hooks first
      for (const [bundleName, bundleHooks] of bundles) {
        console.log(chalk.bold.green(`📦 ${bundleName} bundle`) + chalk.gray(` (${bundleHooks.length} hooks)`));
        for (const hook of bundleHooks) {
          const shortName = hook.name.substring(bundleName.length + 1); // Remove "bundle:" prefix
          console.log(chalk.cyan(`  • ${shortName}`));
          if (hook.description) {
            console.log(chalk.gray(`    ${hook.description}`));
          }
          this.showHookDetails(hook, options, '    ');
        }
        console.log();
      }

      // Show standalone hooks
      if (standaloneHooks.length > 0) {
        if (bundles.size > 0) {
          console.log(chalk.bold('Standalone hooks:'));
        }
        for (const hook of standaloneHooks) {
          console.log(chalk.cyan(`• ${hook.name}`));
          if (hook.description) {
            console.log(chalk.gray(`  ${hook.description}`));
          }
          this.showHookDetails(hook, options, '  ');
          console.log();
        }
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

  private showHookDetails(hook: any, options: ShowOptions, indent: string): void {
    // Basic info
    console.log(chalk.gray(`${indent}Events: ${hook.events.join(', ')}`));
    console.log(chalk.gray(`${indent}Type: ${hook.outputFormat}`));

    if (options.verbose) {
      // Command
      console.log(chalk.gray(`${indent}Command: ${hook.command.join(' ')}`));

      // Priority
      if (hook.priority !== undefined) {
        console.log(chalk.gray(`${indent}Priority: ${hook.priority}`));
      }

      // Timeout
      if (hook.timeout !== undefined) {
        console.log(chalk.gray(`${indent}Timeout: ${hook.timeout}ms`));
      }

      // Matcher (for tool hooks)
      if (hook.matcher !== undefined) {
        console.log(chalk.gray(`${indent}Matcher: ${hook.matcher}`));
      }

      // Text hook specific
      if (hook.outputFormat === 'text') {
        console.log(chalk.gray(`${indent}Message: ${hook.message}`));
        if (hook.exitCodeMap) {
          const codes = Object.entries(hook.exitCodeMap)
            .map(([code, action]) => `${code}=${action}`)
            .join(', ');
          console.log(chalk.gray(`${indent}Exit codes: ${codes}`));
        }
        if (hook.fixInstructions) {
          console.log(chalk.gray(`${indent}Fix: ${hook.fixInstructions}`));
        }
      }
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
