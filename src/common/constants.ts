import { ResourceLimits } from './types';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Version - read from package.json
// Try multiple paths to handle both development and production
let VERSION = '0.1.3'; // fallback
try {
  const possiblePaths = [
    path.join(__dirname, '..', '..', 'package.json'), // from dist
    path.join(__dirname, '..', '..', '..', 'package.json'), // from src in tests
    path.join(process.cwd(), 'package.json'), // current working directory
  ];
  
  for (const packagePath of possiblePaths) {
    if (fs.existsSync(packagePath)) {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      VERSION = packageJson.version;
      break;
    }
  }
} catch {
  // If we can't read package.json, use the fallback
}

export { VERSION };

// File paths
export const CONFIG_FILE_NAME = 'cc-hooks.json';
export const CLAUDE_DIR = '.claude';
export const HOOKS_DIR = 'hooks';
export const LOGS_DIR = 'logs';
export const DEFAULT_LOG_FILE = 'cc-hooks.log';

// Default paths
export const DEFAULT_CONFIG_PATH = path.join(CLAUDE_DIR, CONFIG_FILE_NAME);
export const DEFAULT_HOOKS_PATH = path.join(CLAUDE_DIR, HOOKS_DIR);
export const DEFAULT_LOGS_PATH = path.join(CLAUDE_DIR, LOGS_DIR);
export const DEFAULT_LOG_FILE_PATH = path.join(DEFAULT_LOGS_PATH, DEFAULT_LOG_FILE);

// Settings.json integration
export const ORCHESTRATOR_COMMAND = 'cc-hooks run';
export const SETTINGS_BACKUP_SUFFIX = '.backup';

// Resource limits
export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxOutputBytes: 1048576, // 1MB
  timeoutMs: 60000, // 60 seconds (matches Claude's HOOKS_REFERENCE.md default)
};

// Log rotation
export const MAX_LOG_SIZE_BYTES = 10485760; // 10MB

// Priority
export const DEFAULT_HOOK_PRIORITY = 100;

// Exit codes
export const EXIT_SUCCESS = 0;
export const EXIT_BLOCKING_ERROR = 2;

// Platform
export const IS_WINDOWS = os.platform() === 'win32';
export const IS_MAC = os.platform() === 'darwin';
export const IS_LINUX = os.platform() === 'linux';

// Colors (for CLI output)
export const NO_COLOR = process.env.NO_COLOR || process.env.CI;

// Template directory (relative to package root)
export const TEMPLATES_DIR = 'templates';
