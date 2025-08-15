import { ResourceLimits } from './types';
import path from 'path';
import os from 'os';

// Version
export const VERSION = '0.1.0';

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

// Activation pointer
export const ACTIVATION_POINTER_FILE = 'active';
export const ACTIVATION_POINTER_CONTENT = 'cc-hooks run';

// Resource limits
export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxOutputBytes: 1048576, // 1MB
  timeoutMs: 30000, // 30 seconds
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