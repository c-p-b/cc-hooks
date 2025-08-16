import { ConfigLoader } from '../../../src/orchestrator/config-loader';
import { ConfigValidationError } from '../../../src/common/errors';
import { HooksConfigFile, TextHook, StructuredHook } from '../../../src/common/types';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

describe('ConfigLoader', () => {
  let loader: ConfigLoader;
  let tempDir: string;

  beforeEach(() => {
    loader = new ConfigLoader();
    tempDir = mkdtempSync(path.join(tmpdir(), 'cc-hooks-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('should return empty config for non-existent file', () => {
      const config = loader.load(path.join(tempDir, 'missing.json'));
      expect(config).toEqual({ hooks: [] });
    });

    it('should load and validate a valid config file', () => {
      const validConfig: HooksConfigFile = {
        logging: {
          level: 'verbose',
          path: '/custom/log/path.log'
        },
        hooks: [
          {
            name: 'test-hook',
            command: ['echo', 'test'],
            events: ['PostToolUse'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Test message'
          }
        ]
      };

      const configPath = path.join(tempDir, 'config.json');
      writeFileSync(configPath, JSON.stringify(validConfig));

      const loaded = loader.load(configPath);
      expect(loaded).toEqual(validConfig);
    });

    it('should throw on invalid JSON', () => {
      const configPath = path.join(tempDir, 'invalid.json');
      writeFileSync(configPath, 'not json');

      expect(() => loader.load(configPath)).toThrow(ConfigValidationError);
      expect(() => loader.load(configPath)).toThrow(/Invalid JSON/);
    });
  });

  describe('validate', () => {
    it('should accept minimal valid text hook', () => {
      const config = {
        hooks: [
          {
            name: 'minimal',
            command: ['ls'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Done'
          }
        ]
      };

      const validated = loader.validate(config);
      expect(validated.hooks).toHaveLength(1);
      expect(validated.hooks[0]?.name).toBe('minimal');
    });

    it('should accept minimal valid structured hook', () => {
      const config = {
        hooks: [
          {
            name: 'structured',
            command: ['./check.sh'],
            events: ['PreToolUse'],
            outputFormat: 'structured'
          }
        ]
      };

      const validated = loader.validate(config);
      expect(validated.hooks).toHaveLength(1);
      expect((validated.hooks[0] as StructuredHook).outputFormat).toBe('structured');
    });

    it('should reject non-object config', () => {
      expect(() => loader.validate(null)).toThrow('Configuration must be an object');
      expect(() => loader.validate('string')).toThrow('Configuration must be an object');
      expect(() => loader.validate(123)).toThrow('Configuration must be an object');
    });

    it('should reject missing hooks array', () => {
      expect(() => loader.validate({})).toThrow('hooks must be an array');
    });

    it('should reject invalid event names', () => {
      const config = {
        hooks: [
          {
            name: 'bad-event',
            command: ['ls'],
            events: ['InvalidEvent'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Test'
          }
        ]
      };

      expect(() => loader.validate(config)).toThrow(/Invalid event 'InvalidEvent'/);
    });

    it('should reject invalid output format', () => {
      const config = {
        hooks: [
          {
            name: 'bad-format',
            command: ['ls'],
            events: ['Stop'],
            outputFormat: 'json',
            exitCodeMap: { '0': 'success' },
            message: 'Test'
          }
        ]
      };

      expect(() => loader.validate(config)).toThrow(/outputFormat must be one of/);
    });

    it('should reject text hook without exitCodeMap', () => {
      const config = {
        hooks: [
          {
            name: 'no-map',
            command: ['ls'],
            events: ['Stop'],
            outputFormat: 'text',
            message: 'Test'
          }
        ]
      };

      expect(() => loader.validate(config)).toThrow(/must have an exitCodeMap/);
    });

    it('should reject text hook without message', () => {
      const config = {
        hooks: [
          {
            name: 'no-message',
            command: ['ls'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' }
          }
        ]
      };

      expect(() => loader.validate(config)).toThrow(/must have a message/);
    });

    it('should reject invalid flow control actions', () => {
      const config = {
        hooks: [
          {
            name: 'bad-action',
            command: ['ls'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'continue' },
            message: 'Test'
          }
        ]
      };

      expect(() => loader.validate(config)).toThrow(/Invalid flow control 'continue'/);
    });

    it('should reject empty command array', () => {
      const config = {
        hooks: [
          {
            name: 'empty-cmd',
            command: [],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Test'
          }
        ]
      };

      expect(() => loader.validate(config)).toThrow(/command must be a non-empty array/);
    });

    it('should reject non-string command elements', () => {
      const config = {
        hooks: [
          {
            name: 'bad-cmd',
            command: ['ls', 123],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Test'
          }
        ]
      };

      expect(() => loader.validate(config)).toThrow(/command array must contain only strings/);
    });

    it('should accept optional fields', () => {
      const config = {
        hooks: [
          {
            name: 'full',
            command: ['ls'],
            description: 'List files',
            events: ['Stop'],
            priority: 50,
            timeout: 5000,
            outputFormat: 'text',
            exitCodeMap: { '0': 'success', 'default': 'non-blocking-error' },
            message: 'Done',
            fixInstructions: 'Check permissions'
          }
        ]
      };

      const validated = loader.validate(config);
      const hook = validated.hooks[0] as TextHook;
      expect(hook.description).toBe('List files');
      expect(hook.priority).toBe(50);
      expect(hook.timeout).toBe(5000);
      expect(hook.fixInstructions).toBe('Check permissions');
    });

    it('should validate logging config', () => {
      const config = {
        logging: {
          level: 'verbose',
          path: '/custom/path.log'
        },
        hooks: []
      };

      const validated = loader.validate(config);
      expect(validated.logging?.level).toBe('verbose');
      expect(validated.logging?.path).toBe('/custom/path.log');
    });

    it('should reject invalid log level', () => {
      const config = {
        logging: {
          level: 'debug'
        },
        hooks: []
      };

      expect(() => loader.validate(config)).toThrow(/logging.level must be one of/);
    });
  });

  describe('getActiveHooks', () => {
    const config: HooksConfigFile = {
      hooks: [
        {
          name: 'high-priority',
          command: ['echo', '1'],
          events: ['PostToolUse', 'Stop'],
          priority: 10,
          outputFormat: 'text',
          exitCodeMap: { '0': 'success' },
          message: 'High'
        },
        {
          name: 'default-priority',
          command: ['echo', '2'],
          events: ['PostToolUse'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success' },
          message: 'Default'
        },
        {
          name: 'low-priority',
          command: ['echo', '3'],
          events: ['PostToolUse'],
          priority: 200,
          outputFormat: 'text',
          exitCodeMap: { '0': 'success' },
          message: 'Low'
        },
        {
          name: 'different-event',
          command: ['echo', '4'],
          events: ['PreToolUse'],
          outputFormat: 'text',
          exitCodeMap: { '0': 'success' },
          message: 'Different'
        }
      ]
    };

    it('should filter hooks by event', () => {
      const hooks = loader.getActiveHooks(config, 'PreToolUse');
      expect(hooks).toHaveLength(1);
      expect(hooks[0]?.name).toBe('different-event');
    });

    it('should sort hooks by priority', () => {
      const hooks = loader.getActiveHooks(config, 'PostToolUse');
      expect(hooks).toHaveLength(3);
      expect(hooks[0]?.name).toBe('high-priority');
      expect(hooks[1]?.name).toBe('default-priority');
      expect(hooks[2]?.name).toBe('low-priority');
    });

    it('should handle multiple events per hook', () => {
      const stopHooks = loader.getActiveHooks(config, 'Stop');
      expect(stopHooks).toHaveLength(1);
      expect(stopHooks[0]?.name).toBe('high-priority');
    });

    it('should return empty array for no matching hooks', () => {
      const hooks = loader.getActiveHooks(config, 'SessionStart');
      expect(hooks).toHaveLength(0);
    });
  });
});