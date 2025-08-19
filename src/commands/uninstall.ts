import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import { CCHooksError } from '../common/errors';
import { getLogger } from '../common/logger';
import { HooksConfigFile } from '../common/types';
import { ConfigLoader } from '../orchestrator/config-loader';

export class UninstallCommand {
  private logger = getLogger();
  private configLoader = new ConfigLoader();
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  async execute(hookName?: string): Promise<void> {
    try {
      // Find config file
      const configPath = this.findConfigFile();
      if (!configPath) {
        throw new CCHooksError(
          'cc-hooks is not initialized. Run "cc-hooks init" first.'
        );
      }

      // Load config
      const config = this.configLoader.load(configPath);
      
      // Check if any hooks exist
      if (config.hooks.length === 0) {
        console.log(chalk.yellow('No hooks to uninstall'));
        return;
      }

      // Determine which hook to uninstall
      let targetHook: string;
      
      if (hookName) {
        // Use provided name
        targetHook = hookName;
      } else {
        // Interactive selection
        const selected = await this.selectHookInteractive(config);
        if (!selected) {
          console.log(chalk.gray('Cancelled'));
          return;
        }
        targetHook = selected;
      }

      // Find and remove the hook
      const hookIndex = config.hooks.findIndex(h => h.name === targetHook);
      if (hookIndex === -1) {
        throw new CCHooksError(`Hook '${targetHook}' not found`);
      }

      const removedHook = config.hooks[hookIndex];
      if (!removedHook) {
        throw new CCHooksError(`Unable to find hook at index ${hookIndex}`);
      }
      
      config.hooks.splice(hookIndex, 1);

      // Save updated config
      await this.saveConfig(configPath, config);
      
      console.log(chalk.green(`✓ Uninstalled hook: ${removedHook.name}`));
      if (removedHook.description) {
        console.log(chalk.gray(`  ${removedHook.description}`));
      }
      
    } catch (error) {
      if (error instanceof CCHooksError) {
        throw error;
      }
      throw new CCHooksError(`Failed to uninstall hook: ${error}`);
    }
  }

  private async selectHookInteractive(config: HooksConfigFile): Promise<string | null> {
    console.log(chalk.bold('Select a hook to uninstall:'));
    console.log();

    // Display numbered list
    config.hooks.forEach((hook, index) => {
      console.log(chalk.cyan(`  ${index + 1}. ${hook.name}`));
      if (hook.description) {
        console.log(chalk.gray(`     ${hook.description}`));
      }
    });
    console.log();

    // Create readline interface
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question(chalk.gray('Enter number (or q to quit): '), (answer) => {
        rl.close();
        
        if (answer.toLowerCase() === 'q') {
          resolve(null);
          return;
        }

        const selection = parseInt(answer, 10);
        if (isNaN(selection) || selection < 1 || selection > config.hooks.length) {
          console.log(chalk.red('Invalid selection'));
          resolve(null);
          return;
        }

        const hook = config.hooks[selection - 1];
        resolve(hook ? hook.name : null);
      });
    });
  }

  private findConfigFile(): string | null {
    const locations = [
      path.join(this.cwd, '.claude', 'cc-hooks-local.json'),
      path.join(this.cwd, '.claude', 'cc-hooks.json'),
      path.join(this.cwd, 'cc-hooks.json'),
      path.join(process.env.HOME || '', '.claude', 'cc-hooks.json')
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