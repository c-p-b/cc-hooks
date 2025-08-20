import {
  CCHooksError,
  HookExecutionError,
  ConfigValidationError,
  InstallationError,
  MigrationError,
  FileOperationError,
  PlatformError,
} from '../../../src/common/errors';

describe('Error Classes', () => {
  describe('CCHooksError', () => {
    it('should create error with correct name and message', () => {
      const error = new CCHooksError('Test error message');
      expect(error.name).toBe('CCHooksError');
      expect(error.message).toBe('Test error message');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('HookExecutionError', () => {
    it('should create error for failed hook execution', () => {
      const error = new HookExecutionError('test-hook', 1, 'Command failed', false);
      expect(error.name).toBe('HookExecutionError');
      expect(error.hookName).toBe('test-hook');
      expect(error.exitCode).toBe(1);
      expect(error.stderr).toBe('Command failed');
      expect(error.timedOut).toBe(false);
      expect(error.message).toContain('exited with code 1');
    });

    it('should create error for timed out hook', () => {
      const error = new HookExecutionError('slow-hook', -1, 'Timeout', true);
      expect(error.timedOut).toBe(true);
      expect(error.message).toContain('timed out');
    });
  });

  describe('ConfigValidationError', () => {
    it('should create error with validation errors list', () => {
      const validationErrors = ['Invalid hook name', 'Missing required field'];
      const error = new ConfigValidationError('/path/to/config.json', validationErrors);
      expect(error.name).toBe('ConfigValidationError');
      expect(error.configPath).toBe('/path/to/config.json');
      expect(error.validationErrors).toEqual(validationErrors);
      expect(error.message).toContain('Invalid configuration');
      expect(error.message).toContain('Invalid hook name');
      expect(error.message).toContain('Missing required field');
    });
  });

  describe('InstallationError', () => {
    it('should create error for failed installation', () => {
      const error = new InstallationError('typescript-lint', 'Template not found');
      expect(error.name).toBe('InstallationError');
      expect(error.source).toBe('typescript-lint');
      expect(error.reason).toBe('Template not found');
      expect(error.message).toContain('Failed to install');
      expect(error.message).toContain('typescript-lint');
    });
  });

  describe('MigrationError', () => {
    it('should create error for failed migration', () => {
      const error = new MigrationError('/old/hooks', 'Invalid hook format');
      expect(error.name).toBe('MigrationError');
      expect(error.originalPath).toBe('/old/hooks');
      expect(error.reason).toBe('Invalid hook format');
      expect(error.message).toContain('Failed to migrate');
    });
  });

  describe('FileOperationError', () => {
    it('should wrap file operation errors', () => {
      const originalError = new Error('Permission denied');
      const error = new FileOperationError('write', '/path/to/file', originalError);
      expect(error.name).toBe('FileOperationError');
      expect(error.operation).toBe('write');
      expect(error.filePath).toBe('/path/to/file');
      expect(error.originalError).toBe(originalError);
      expect(error.message).toContain('Failed to write');
      expect(error.message).toContain('Permission denied');
    });
  });

  describe('PlatformError', () => {
    it('should create error for unsupported platform', () => {
      const error = new PlatformError('win32');
      expect(error.name).toBe('PlatformError');
      expect(error.platform).toBe('win32');
      expect(error.message).toContain('not supported');
      expect(error.message).toContain('WSL');
    });
  });
});
