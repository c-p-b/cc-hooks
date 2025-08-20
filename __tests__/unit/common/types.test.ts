import {
  ClaudeEventName,
  HooksConfigFile,
  TextHook,
  StructuredHook,
} from '../../../src/common/types';

describe('Type Definitions', () => {
  describe('ClaudeEventName', () => {
    it('should accept valid event names', () => {
      const validEvents: ClaudeEventName[] = [
        'PreToolUse',
        'PostToolUse',
        'Stop',
        'UserPromptSubmit',
        'Notification',
        'SubagentStop',
        'PreCompact',
        'SessionStart',
      ];

      // This test just ensures the types compile correctly
      expect(validEvents).toHaveLength(8);
    });
  });

  describe('TextHook', () => {
    it('should create valid text hook configuration', () => {
      const textHook: TextHook = {
        name: 'test-linter',
        command: ['npm', 'run', 'lint'],
        events: ['PostToolUse'],
        outputFormat: 'text',
        exitCodeMap: {
          '0': 'success',
          '1': 'non-blocking-error',
          default: 'blocking-error',
        },
        message: 'Linting failed',
        priority: 50,
        timeout: 15000,
      };

      expect(textHook.outputFormat).toBe('text');
      expect(textHook.exitCodeMap['0']).toBe('success');
      expect(textHook.priority).toBe(50);
    });
  });

  describe('StructuredHook', () => {
    it('should create valid structured hook configuration', () => {
      const structuredHook: StructuredHook = {
        name: 'advanced-linter',
        command: ['node', 'lint-adapter.js'],
        events: ['PostToolUse', 'Stop'],
        outputFormat: 'structured',
        description: 'Advanced linting with detailed reports',
      };

      expect(structuredHook.outputFormat).toBe('structured');
      expect(structuredHook.events).toContain('PostToolUse');
      expect(structuredHook.events).toContain('Stop');
    });
  });

  describe('HooksConfigFile', () => {
    it('should create valid configuration file structure', () => {
      const config: HooksConfigFile = {
        logging: {
          level: 'verbose',
          path: './.claude/logs/custom.log',
        },
        hooks: [
          {
            name: 'typescript-lint',
            command: ['eslint', '.'],
            events: ['PostToolUse'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success', default: 'non-blocking-error' },
            message: 'ESLint found issues',
          },
          {
            name: 'test-runner',
            command: ['npm', 'test'],
            events: ['Stop'],
            outputFormat: 'structured',
          },
        ],
      };

      expect(config.logging?.level).toBe('verbose');
      expect(config.hooks).toHaveLength(2);
      expect(config.hooks[0]!.outputFormat).toBe('text');
      expect(config.hooks[1]!.outputFormat).toBe('structured');
    });
  });
});
