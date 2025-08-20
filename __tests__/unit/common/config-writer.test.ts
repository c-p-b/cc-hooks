import { ConfigWriter } from '../../../src/common/config-writer';
import { FileOperationError } from '../../../src/common/errors';
import { HooksConfigFile, TextHook } from '../../../src/common/types';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

describe('ConfigWriter', () => {
  let writer: ConfigWriter;
  let tempDir: string;

  beforeEach(() => {
    writer = new ConfigWriter();
    tempDir = mkdtempSync(path.join(tmpdir(), 'cc-hooks-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('write', () => {
    it('should write config with pretty formatting', () => {
      const config: HooksConfigFile = {
        logging: {
          level: 'verbose',
        },
        hooks: [
          {
            name: 'test-hook',
            command: ['echo', 'test'],
            events: ['PostToolUse'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Test message',
          },
        ],
      };

      const configPath = path.join(tempDir, 'config.json');
      writer.write(configPath, config);

      const content = readFileSync(configPath, 'utf-8');
      expect(content).toContain('  "logging"');
      expect(content).toContain('    "level": "verbose"');
      expect(content.endsWith('\n')).toBe(true);

      const parsed = JSON.parse(content);
      expect(parsed).toEqual(config);
    });

    it('should create parent directories if needed', () => {
      const config: HooksConfigFile = { hooks: [] };
      const deepPath = path.join(tempDir, 'a', 'b', 'c', 'config.json');

      writer.write(deepPath, config);

      expect(existsSync(deepPath)).toBe(true);
    });

    it('should overwrite existing file', () => {
      const configPath = path.join(tempDir, 'config.json');

      const config1: HooksConfigFile = {
        hooks: [
          {
            name: 'hook1',
            command: ['ls'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'First',
          },
        ],
      };

      const config2: HooksConfigFile = {
        hooks: [
          {
            name: 'hook2',
            command: ['pwd'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Second',
          },
        ],
      };

      writer.write(configPath, config1);
      writer.write(configPath, config2);

      const content = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.hooks[0].name).toBe('hook2');
    });
  });

  describe('ensureDirectoryExists', () => {
    it('should create directory if it does not exist', () => {
      const dirPath = path.join(tempDir, 'new-dir');
      expect(existsSync(dirPath)).toBe(false);

      writer.ensureDirectoryExists(dirPath);

      expect(existsSync(dirPath)).toBe(true);
    });

    it('should not error if directory already exists', () => {
      const dirPath = tempDir;
      expect(existsSync(dirPath)).toBe(true);

      expect(() => writer.ensureDirectoryExists(dirPath)).not.toThrow();
    });

    it('should create nested directories', () => {
      const nestedPath = path.join(tempDir, 'a', 'b', 'c');

      writer.ensureDirectoryExists(nestedPath);

      expect(existsSync(nestedPath)).toBe(true);
    });
  });

  describe('addHook', () => {
    const baseConfig: HooksConfigFile = {
      hooks: [
        {
          name: 'existing',
          command: ['echo'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success' },
          message: 'Existing hook',
        },
      ],
    };

    const newHook: TextHook = {
      name: 'new-hook',
      command: ['ls'],
      events: ['PostToolUse'],
      outputFormat: 'text',
      exitCodeMap: { '0': 'success' },
      message: 'New hook',
    };

    it('should add hook to config', () => {
      const updated = writer.addHook(baseConfig, newHook);

      expect(updated.hooks).toHaveLength(2);
      expect(updated.hooks[1]?.name).toBe('new-hook');
      expect(baseConfig.hooks).toHaveLength(1);
    });

    it('should throw on duplicate name', () => {
      const duplicate = { ...newHook, name: 'existing' };

      expect(() => writer.addHook(baseConfig, duplicate)).toThrow(FileOperationError);
      expect(() => writer.addHook(baseConfig, duplicate)).toThrow(/already exists/);
    });

    it('should preserve immutability', () => {
      const updated = writer.addHook(baseConfig, newHook);

      expect(updated).not.toBe(baseConfig);
      expect(updated.hooks).not.toBe(baseConfig.hooks);
    });
  });

  describe('removeHook', () => {
    const config: HooksConfigFile = {
      hooks: [
        {
          name: 'hook1',
          command: ['echo', '1'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success' },
          message: 'First',
        },
        {
          name: 'hook2',
          command: ['echo', '2'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success' },
          message: 'Second',
        },
      ],
    };

    it('should remove hook by name', () => {
      const updated = writer.removeHook(config, 'hook1');

      expect(updated.hooks).toHaveLength(1);
      expect(updated.hooks[0]?.name).toBe('hook2');
      expect(config.hooks).toHaveLength(2);
    });

    it('should throw if hook not found', () => {
      expect(() => writer.removeHook(config, 'nonexistent')).toThrow(FileOperationError);
      expect(() => writer.removeHook(config, 'nonexistent')).toThrow(/not found/);
    });
  });

  describe('updateHook', () => {
    const config: HooksConfigFile = {
      hooks: [
        {
          name: 'original',
          command: ['echo'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success' },
          message: 'Original',
        },
        {
          name: 'other',
          command: ['ls'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success' },
          message: 'Other',
        },
      ],
    };

    it('should update hook in place', () => {
      const updatedHook: TextHook = {
        name: 'original',
        command: ['echo', 'updated'],
        events: ['PostToolUse'],
        outputFormat: 'text',
        exitCodeMap: { '0': 'success', '1': 'non-blocking-error' },
        message: 'Updated message',
      };

      const updated = writer.updateHook(config, 'original', updatedHook);

      expect(updated.hooks[0]?.command).toEqual(['echo', 'updated']);
      expect(updated.hooks[0]?.events).toEqual(['PostToolUse']);
      expect((updated.hooks[0] as TextHook).message).toBe('Updated message');
    });

    it('should allow renaming if no conflict', () => {
      const renamedHook: TextHook = {
        name: 'renamed',
        command: ['echo'],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: { '0': 'success' },
        message: 'Renamed',
      };

      const updated = writer.updateHook(config, 'original', renamedHook);

      expect(updated.hooks[0]?.name).toBe('renamed');
      expect(writer.hookExists(updated, 'original')).toBe(false);
      expect(writer.hookExists(updated, 'renamed')).toBe(true);
    });

    it('should throw on rename conflict', () => {
      const conflictingHook: TextHook = {
        name: 'other',
        command: ['echo'],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: { '0': 'success' },
        message: 'Conflict',
      };

      expect(() => writer.updateHook(config, 'original', conflictingHook)).toThrow(
        FileOperationError,
      );
      expect(() => writer.updateHook(config, 'original', conflictingHook)).toThrow(
        /already exists/,
      );
    });

    it('should throw if hook not found', () => {
      const updatedHook: TextHook = {
        name: 'new',
        command: ['echo'],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: { '0': 'success' },
        message: 'New',
      };

      expect(() => writer.updateHook(config, 'nonexistent', updatedHook)).toThrow(
        FileOperationError,
      );
      expect(() => writer.updateHook(config, 'nonexistent', updatedHook)).toThrow(/not found/);
    });
  });

  describe('hookExists', () => {
    const config: HooksConfigFile = {
      hooks: [
        {
          name: 'exists',
          command: ['echo'],
          events: ['Stop'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success' },
          message: 'Test',
        },
      ],
    };

    it('should return true for existing hook', () => {
      expect(writer.hookExists(config, 'exists')).toBe(true);
    });

    it('should return false for non-existing hook', () => {
      expect(writer.hookExists(config, 'nonexistent')).toBe(false);
    });
  });

  describe('createEmptyConfig', () => {
    it('should create config with default logging and empty hooks', () => {
      const config = writer.createEmptyConfig();

      expect(config.logging?.level).toBe('errors');
      expect(config.hooks).toEqual([]);
    });
  });
});
