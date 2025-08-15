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
  .action(async (_options) => {
    try {
      // TODO: Import and execute InitCommand
      console.log(chalk.green('✓ cc-hooks initialized successfully'));
    } catch (error) {
      handleError(error);
    }
  });

// Install command
program
  .command('install <source>')
  .description('Install a hook from a template, Git repository, or local path')
  .option('-f, --force', 'force installation, overwriting conflicts')
  .action(async (source, _options) => {
    try {
      // TODO: Import and execute InstallCommand
      console.log(chalk.green(`✓ Hook installed from ${source}`));
    } catch (error) {
      handleError(error);
    }
  });

// Uninstall command
program
  .command('uninstall [hookName]')
  .description('Uninstall a hook (interactive if no name provided)')
  .action(async (_hookName) => {
    try {
      // TODO: Import and execute UninstallCommand
      console.log(chalk.green(`✓ Hook uninstalled`));
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
  .action(async (_options) => {
    try {
      // TODO: Import and execute ShowCommand
    } catch (error) {
      handleError(error);
    }
  });

// Migrate command
program
  .command('migrate')
  .description('Migrate existing vanilla hooks to cc-hooks')
  .option('-i, --interactive', 'interactive migration mode')
  .action(async (_options) => {
    try {
      // TODO: Import and execute MigrateCommand
      console.log(chalk.green('✓ Migration completed'));
    } catch (error) {
      handleError(error);
    }
  });

// Run command (internal, not shown in help by default)
program
  .command('run', { hidden: true })
  .description('Execute hooks for a Claude event (internal use)')
  .action(async () => {
    try {
      // TODO: Import and execute RunCommand
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