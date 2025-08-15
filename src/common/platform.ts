import { IS_WINDOWS } from './constants';
import { PlatformError } from './errors';
import chalk from 'chalk';

/**
 * Check if the current platform is supported
 * Windows users must use WSL/WSL2 for MVP
 */
export function checkPlatformSupport(): void {
  if (IS_WINDOWS && !process.env.WSL_DISTRO_NAME) {
    console.error(chalk.red('═══════════════════════════════════════════'));
    console.error(chalk.red('  Windows Native Support Not Available'));
    console.error(chalk.yellow('  Please use WSL or WSL2 to run cc-hooks'));
    console.error(chalk.cyan('  Install: https://aka.ms/wsl'));
    console.error(chalk.red('═══════════════════════════════════════════'));
    throw new PlatformError('win32');
  }
}

/**
 * Get platform-specific path separator
 */
export function getPathSeparator(): string {
  return IS_WINDOWS ? '\\' : '/';
}

/**
 * Normalize path for current platform
 */
export function normalizePath(filePath: string): string {
  if (IS_WINDOWS) {
    return filePath.replace(/\//g, '\\');
  }
  return filePath.replace(/\\/g, '/');
}