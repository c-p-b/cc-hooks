/**
 * Base error class for all cc-hooks errors
 */
export class CCHooksError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CCHooksError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Thrown when a hook execution fails
 */
export class HookExecutionError extends CCHooksError {
  constructor(
    public readonly hookName: string,
    public readonly exitCode: number,
    public readonly stderr: string,
    public readonly timedOut: boolean = false,
  ) {
    const reason = timedOut ? 'timed out' : `exited with code ${exitCode}`;
    super(`Hook '${hookName}' ${reason}: ${stderr}`);
    this.name = 'HookExecutionError';
  }
}

/**
 * Thrown when configuration validation fails
 */
export class ConfigValidationError extends CCHooksError {
  constructor(
    public readonly configPath: string,
    public readonly validationErrors: string[],
  ) {
    super(
      `Invalid configuration in ${configPath}:\n${validationErrors.map((e) => `  - ${e}`).join('\n')}`,
    );
    this.name = 'ConfigValidationError';
  }
}

/**
 * Thrown when hook installation fails
 */
export class InstallationError extends CCHooksError {
  constructor(
    public readonly source: string,
    public readonly reason: string,
  ) {
    super(`Failed to install from '${source}': ${reason}`);
    this.name = 'InstallationError';
  }
}

/**
 * Thrown when migration fails
 */
export class MigrationError extends CCHooksError {
  constructor(
    public readonly originalPath: string,
    public readonly reason: string,
  ) {
    super(`Failed to migrate hooks from '${originalPath}': ${reason}`);
    this.name = 'MigrationError';
  }
}

/**
 * Thrown when a file operation fails
 */
export class FileOperationError extends CCHooksError {
  constructor(
    public readonly operation: 'read' | 'write' | 'delete' | 'create',
    public readonly filePath: string,
    public readonly originalError: Error,
  ) {
    super(`Failed to ${operation} file '${filePath}': ${originalError.message}`);
    this.name = 'FileOperationError';
  }
}

/**
 * Thrown when platform is not supported
 */
export class PlatformError extends CCHooksError {
  constructor(public readonly platform: string) {
    super(`Platform '${platform}' is not supported. Windows users: Please use WSL or WSL2.`);
    this.name = 'PlatformError';
  }
}
