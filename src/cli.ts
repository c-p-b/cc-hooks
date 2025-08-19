#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { checkPlatformSupport } from './common/platform';
import { VERSION, NO_COLOR } from './common/constants';
import { CCHooksError } from './common/errors';
import { getLogger } from './common/logger';

// Disable chalk colors if NO_COLOR is set
if (NO_COLOR) {
  chalk.level = 0;
}

// Check platform support before doing anything else
try {
  checkPlatformSupport();
} catch (error) {
  if (error instanceof CCHooksError) {
    process.exit(1);
  }
  throw error;
}

const program = new Command();
const logger = getLogger();

// Set up the main program
program
  .name('cc-hooks')
  .description('A universal, stable, and user-friendly hook management system for Claude Code')
  .version(VERSION, '-v, --version', 'output the current version')
  .option('--debug', 'enable debug output')
  .hook('preAction', (thisCommand) => {
    if (thisCommand.opts().debug) {
      // Enable verbose logging for debug mode
      process.env.CC_HOOKS_DEBUG = 'true';
    }
  });


// Init command
program
  .command('init')
  .description('Initialize cc-hooks for the current project')
  .option('-f, --force', 'force initialization, overwriting existing configuration')
  .action(async (options) => {
    try {
      const { InitCommand } = await import('./commands/init');
      const command = new InitCommand(process.cwd());
      await command.execute(options);
    } catch (error) {
      handleError(error);
    }
  });

// Uninit command
program
  .command('uninit')
  .description('Deactivate cc-hooks and remove all configurations')
  .action(async () => {
    try {
      const { UninitCommand } = await import('./commands/uninit');
      const command = new UninitCommand(process.cwd());
      await command.execute();
    } catch (error) {
      handleError(error);
    }
  });

// Install command
program
  .command('install <source>')
  .description('Install a hook from a template, Git repository, or local path')
  .option('-f, --force', 'force installation, overwriting conflicts')
  .action(async (source, options) => {
    try {
      const { InstallCommand } = await import('./commands/install');
      const command = new InstallCommand(process.cwd());
      await command.execute(source, options);
    } catch (error) {
      handleError(error);
    }
  });

// Uninstall command
program
  .command('uninstall [hookName]')
  .description('Uninstall a hook (interactive if no name provided)')
  .action(async (hookName) => {
    try {
      const { UninstallCommand } = await import('./commands/uninstall');
      const command = new UninstallCommand(process.cwd());
      await command.execute(hookName);
    } catch (error) {
      handleError(error);
    }
  });

// Show command
program
  .command('show')
  .alias('list')
  .description('Show all configured hooks')
  .option('-v, --verbose', 'show detailed information')
  .action(async (options) => {
    try {
      const { ShowCommand } = await import('./commands/show');
      const command = new ShowCommand(process.cwd());
      await command.execute(options);
    } catch (error) {
      handleError(error);
    }
  });

// Migrate command
program
  .command('migrate')
  .description('Migrate existing vanilla hooks to cc-hooks')
  .option('-i, --interactive', 'interactive migration mode')
  .action(async (options) => {
    try {
      const { MigrateCommand } = await import('./commands/migrate');
      const command = new MigrateCommand(process.cwd());
      await command.execute(options);
    } catch (error) {
      handleError(error);
    }
  });

// Logs command
program
  .command('logs [hookName]')
  .description('View hook execution logs')
  .option('-f, --follow', 'tail logs in real-time')
  .option('-s, --session', 'show current session only')
  .option('--failed', 'show failed hooks only')
  .option('-n, --limit <number>', 'number of entries to show', '20')
  .option('-v, --verbose', 'show detailed information')
  .action(async (hookName, options) => {
    try {
      const { LogsCommand } = await import('./commands/logs');
      const command = new LogsCommand();
      await command.execute(hookName, {
        follow: options.follow,
        session: options.session,
        failed: options.failed,
        limit: parseInt(options.limit, 10),
        verbose: options.verbose,
      });
    } catch (error) {
      handleError(error);
    }
  });

// Run command
program
  .command('run')
  .description('Execute hooks for testing or when called by Claude Code')
  .option('-c, --config <path>', 'path to custom cc-hooks.json file (overrides auto-discovery)')
  .option('-e, --event <event>', 'event name for testing')
  .option('-m, --mock-data <file>', 'mock event data file for testing')
  .action(async (options) => {
    try {
      const { RunCommand } = await import('./commands/run');
      const command = new RunCommand(process.cwd());
      await command.execute(options);
    } catch (error) {
      // For the run command, we need specific error handling
      // to communicate with Claude properly
      if (error instanceof CCHooksError) {
        console.error(error.message);
        process.exit(2); // Blocking error for Claude
      }
      console.error(`Unexpected error: ${error}`);
      process.exit(1);
    }
  });

// Global error handler
function handleError(error: unknown): void {
  logger.logError(error as Error);
  
  if (error instanceof CCHooksError) {
    console.error(chalk.red(`Error: ${error.message}`));
    
    // Provide helpful suggestions based on error type
    if (error.name === 'ConfigValidationError') {
      console.error(chalk.yellow('\nPlease check your cc-hooks.json configuration'));
    } else if (error.name === 'InstallationError') {
      console.error(chalk.yellow('\nTry running with --force to overwrite conflicts'));
    } else if (error.name === 'FileOperationError') {
      console.error(chalk.yellow('\nCheck file permissions and try again'));
    }
  } else if (error instanceof Error) {
    console.error(chalk.red(`Unexpected error: ${error.message}`));
    if (process.env.CC_HOOKS_DEBUG) {
      console.error(chalk.gray(error.stack));
    }
  } else {
    console.error(chalk.red('An unknown error occurred'));
  }
  
  process.exit(1);
}

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}