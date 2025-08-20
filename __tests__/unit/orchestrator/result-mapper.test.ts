import { ResultMapper } from '../../../src/orchestrator/result-mapper';
import { TextHook, StructuredHook, HookExecutionResult } from '../../../src/common/types';

describe('ResultMapper', () => {
  let mapper: ResultMapper;

  beforeEach(() => {
    mapper = new ResultMapper();
  });

  describe('Text Hook Mapping', () => {
    const textHook: TextHook = {
      name: 'test-hook',
      command: ['echo', 'test'],
      events: ['PostToolUse'],
      outputFormat: 'text',
      exitCodeMap: {
        '0': 'success',
        '1': 'non-blocking-error',
        '2': 'blocking-error',
      },
      message: 'Test completed',
    };

    it('should map exit code 0 to success', () => {
      const result: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: 'OK',
        stderr: '',
        truncated: false,
        timedOut: false,
      };

      const mapped = mapper.map(textHook, result);
      expect(mapped.flowControl).toBe('success');
      expect(mapped.message).toBe('Test completed');
      expect(mapped.rawOutput).toBe('OK');
    });

    it('should map exit code 1 to non-blocking-error', () => {
      const result: HookExecutionResult = {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'Warning',
        truncated: false,
        timedOut: false,
      };

      const mapped = mapper.map(textHook, result);
      expect(mapped.flowControl).toBe('non-blocking-error');
      expect(mapped.message).toBe('Test completed');
    });

    it('should map exit code 2 to blocking-error', () => {
      const result: HookExecutionResult = {
        success: false,
        exitCode: 2,
        stdout: '',
        stderr: 'Error',
        truncated: false,
        timedOut: false,
      };

      const mapped = mapper.map(textHook, result);
      expect(mapped.flowControl).toBe('blocking-error');
    });

    it('should use default mapping when available', () => {
      const hookWithDefault: TextHook = {
        ...textHook,
        exitCodeMap: {
          '0': 'success',
          default: 'blocking-error',
        },
      };

      const result: HookExecutionResult = {
        success: false,
        exitCode: 99,
        stdout: '',
        stderr: 'Unknown error',
        truncated: false,
        timedOut: false,
      };

      const mapped = mapper.map(hookWithDefault, result);
      expect(mapped.flowControl).toBe('blocking-error');
    });

    it('should add timeout message', () => {
      const result: HookExecutionResult = {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: '',
        truncated: false,
        timedOut: true,
      };

      const mapped = mapper.map(textHook, result);
      expect(mapped.message).toContain('timed out');
    });

    it('should add truncation message', () => {
      const result: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: 'Truncated output',
        stderr: '',
        truncated: true,
        timedOut: false,
      };

      const mapped = mapper.map(textHook, result);
      expect(mapped.message).toContain('output truncated');
    });
  });

  describe('Structured Hook Mapping', () => {
    const structuredHook: StructuredHook = {
      name: 'structured-hook',
      command: ['./check.sh'],
      events: ['PreToolUse'],
      outputFormat: 'structured',
    };

    it('should parse valid diagnostic report', () => {
      const diagnosticReport = {
        success: false,
        findings: [
          {
            file: 'test.ts',
            line: 10,
            message: 'Type error',
            severity: 'error' as const,
          },
        ],
      };

      const result: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify(diagnosticReport),
        stderr: '',
        truncated: false,
        timedOut: false,
      };

      const mapped = mapper.map(structuredHook, result);
      expect(mapped.flowControl).toBe('non-blocking-error'); // Because report.success is false
      expect(mapped.diagnostics).toEqual(diagnosticReport);
    });

    it('should handle control flow in diagnostic report', () => {
      const diagnosticReport = {
        success: true,
        findings: [],
        controlFlow: {
          continue: false,
          reason: 'Critical error',
          decision: 'block' as const,
        },
      };

      const result: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify(diagnosticReport),
        stderr: '',
        truncated: false,
        timedOut: false,
      };

      const mapped = mapper.map(structuredHook, result);
      expect(mapped.flowControl).toBe('blocking-error');
      expect(mapped.diagnostics?.controlFlow?.decision).toBe('block');
    });

    it('should handle invalid JSON gracefully', () => {
      const result: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: 'Not valid JSON',
        stderr: '',
        truncated: false,
        timedOut: false,
      };

      const mapped = mapper.map(structuredHook, result);
      expect(mapped.flowControl).toBe('success');
      expect(mapped.diagnostics).toBeUndefined();
      expect(mapped.rawOutput).toBe('Not valid JSON');
    });

    it('should use exit code when JSON parsing fails', () => {
      const result: HookExecutionResult = {
        success: false,
        exitCode: 2,
        stdout: 'Invalid JSON',
        stderr: 'Parse error',
        truncated: false,
        timedOut: false,
      };

      const mapped = mapper.map(structuredHook, result);
      expect(mapped.flowControl).toBe('blocking-error');
      expect(mapped.diagnostics).toBeUndefined();
    });

    it('should validate diagnostic report structure', () => {
      const invalidReport = {
        success: true,
        findings: [
          {
            file: 'test.ts',
            line: 'not a number', // Invalid
            message: 'Error',
            severity: 'error',
          },
        ],
      };

      const result: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify(invalidReport),
        stderr: '',
        truncated: false,
        timedOut: false,
      };

      const mapped = mapper.map(structuredHook, result);
      expect(mapped.diagnostics).toBeUndefined(); // Should reject invalid structure
    });

    it('should handle timeout for structured hooks', () => {
      const result: HookExecutionResult = {
        success: false,
        exitCode: 124, // Timeout exit code
        stdout: '',
        stderr: '',
        truncated: false,
        timedOut: true,
      };

      const hookWithTimeout: StructuredHook = {
        ...structuredHook,
        timeout: 5000,
      };

      const mapped = mapper.map(hookWithTimeout, result);
      expect(mapped.message).toContain('timed out after 5000ms');
    });
  });

  describe('Edge Cases', () => {
    it('should handle null exit code', () => {
      const hook: TextHook = {
        name: 'test',
        command: ['test'],
        events: ['Stop'],
        outputFormat: 'text',
        exitCodeMap: { '0': 'success' },
        message: 'Test',
      };

      const result: HookExecutionResult = {
        success: false,
        exitCode: null as any, // Killed by signal
        stdout: '',
        stderr: 'Killed',
        truncated: false,
        timedOut: false,
      };

      const mapped = mapper.map(hook, result);
      expect(mapped.flowControl).toBe('non-blocking-error');
    });

    it('should handle empty output', () => {
      const hook: StructuredHook = {
        name: 'empty',
        command: ['true'],
        events: ['Stop'],
        outputFormat: 'structured',
      };

      const result: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        truncated: false,
        timedOut: false,
      };

      const mapped = mapper.map(hook, result);
      expect(mapped.flowControl).toBe('success');
      expect(mapped.rawOutput).toBe('');
      expect(mapped.diagnostics).toBeUndefined();
    });
  });
});
