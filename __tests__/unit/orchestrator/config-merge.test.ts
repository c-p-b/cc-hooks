import { ConfigLoader } from '../../../src/orchestrator/config-loader';
import { HooksConfigFile, TextHook } from '../../../src/common/types';

describe('ConfigLoader merge', () => {
  let loader: ConfigLoader;

  beforeEach(() => {
    loader = new ConfigLoader();
  });

  describe('merge()', () => {
    it('should merge empty configs', () => {
      const config1: HooksConfigFile = { hooks: [] };
      const config2: HooksConfigFile = { hooks: [] };

      const merged = loader.merge(config1, config2);

      expect(merged.hooks).toEqual([]);
      expect(merged.logging).toBeUndefined();
    });

    it('should add hooks from later configs', () => {
      const config1: HooksConfigFile = {
        hooks: [
          {
            name: 'hook1',
            command: ['echo', 'one'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Hook 1',
          },
        ],
      };

      const config2: HooksConfigFile = {
        hooks: [
          {
            name: 'hook2',
            command: ['echo', 'two'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Hook 2',
          },
        ],
      };

      const merged = loader.merge(config1, config2);

      expect(merged.hooks).toHaveLength(2);
      expect(merged.hooks.map((h) => h.name)).toEqual(['hook1', 'hook2']);
    });

    it('should replace hooks with same name (key-by-key replacement)', () => {
      const config1: HooksConfigFile = {
        hooks: [
          {
            name: 'lint',
            command: ['eslint', '.'],
            events: ['PostToolUse'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Global lint',
          },
          {
            name: 'test',
            command: ['npm', 'test'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Global test',
          },
        ],
      };

      const config2: HooksConfigFile = {
        hooks: [
          {
            name: 'lint',
            command: ['npm', 'run', 'lint'],
            events: ['PostToolUse'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success', '1': 'non-blocking-error' },
            message: 'Project lint',
          },
        ],
      };

      const merged = loader.merge(config1, config2);

      expect(merged.hooks).toHaveLength(2);

      const lintHook = merged.hooks.find((h) => h.name === 'lint') as TextHook;
      expect(lintHook?.command).toEqual(['npm', 'run', 'lint']);
      expect(lintHook?.message).toBe('Project lint');
      expect(lintHook?.exitCodeMap).toEqual({ '0': 'success', '1': 'non-blocking-error' });

      const testHook = merged.hooks.find((h) => h.name === 'test') as TextHook;
      expect(testHook?.command).toEqual(['npm', 'test']);
      expect(testHook?.message).toBe('Global test');
    });

    it('should handle three-tier merge (global -> project -> local)', () => {
      const global: HooksConfigFile = {
        logging: { level: 'errors' },
        hooks: [
          {
            name: 'hook1',
            command: ['echo', 'global'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Global hook',
          },
          {
            name: 'hook2',
            command: ['echo', 'global2'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Global hook 2',
          },
        ],
      };

      const project: HooksConfigFile = {
        logging: { level: 'verbose' },
        hooks: [
          {
            name: 'hook1',
            command: ['echo', 'project'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Project hook',
          },
          {
            name: 'hook3',
            command: ['echo', 'project3'],
            events: ['UserPromptSubmit'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Project hook 3',
          },
        ],
      };

      const local: HooksConfigFile = {
        hooks: [
          {
            name: 'hook2',
            command: ['echo', 'local2'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'Local hook 2',
          },
        ],
      };

      const merged = loader.merge(global, project, local);

      // Logging should be from project (last one with logging defined)
      expect(merged.logging?.level).toBe('verbose');

      // Should have 3 hooks total
      expect(merged.hooks).toHaveLength(3);

      // hook1 should be from project (overrode global)
      const hook1 = merged.hooks.find((h) => h.name === 'hook1') as TextHook;
      expect(hook1?.command).toEqual(['echo', 'project']);
      expect(hook1?.message).toBe('Project hook');

      // hook2 should be from local (overrode global)
      const hook2 = merged.hooks.find((h) => h.name === 'hook2') as TextHook;
      expect(hook2?.command).toEqual(['echo', 'local2']);
      expect(hook2?.message).toBe('Local hook 2');

      // hook3 should be from project (not overridden)
      const hook3 = merged.hooks.find((h) => h.name === 'hook3') as TextHook;
      expect(hook3?.command).toEqual(['echo', 'project3']);
      expect(hook3?.message).toBe('Project hook 3');
    });

    it('should preserve hook order within each config', () => {
      const config1: HooksConfigFile = {
        hooks: [
          {
            name: 'a',
            command: ['echo', 'a'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'A',
          },
          {
            name: 'b',
            command: ['echo', 'b'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'B',
          },
        ],
      };

      const config2: HooksConfigFile = {
        hooks: [
          {
            name: 'c',
            command: ['echo', 'c'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'C',
          },
          {
            name: 'a',
            command: ['echo', 'a2'],
            events: ['Stop'],
            outputFormat: 'text',
            exitCodeMap: { '0': 'success' },
            message: 'A2',
          },
        ],
      };

      const merged = loader.merge(config1, config2);

      expect(merged.hooks).toHaveLength(3);
      // Order should be: a (from config1), b (from config1), c (new from config2)
      // Then a gets replaced by config2's version but maintains first appearance order
      expect(merged.hooks.map((h) => h.name)).toEqual(['a', 'b', 'c']);

      const hookA = merged.hooks.find((h) => h.name === 'a') as TextHook;
      expect(hookA?.message).toBe('A2'); // Should be replaced version
    });
  });
});
