import { 
  TextHook, 
  StructuredHook, 
  HookDefinition,
  FlowControlAction,
  DiagnosticReport,
  HookExecutionResult
} from '../common/types';
import { getLogger } from '../common/logger';

export interface MappedResult {
  flowControl: FlowControlAction;
  message?: string;
  diagnostics?: DiagnosticReport;
  rawOutput: string;
}

/**
 * Maps hook execution results to flow control actions and parses output.
 */
export class ResultMapper {
  private logger = getLogger();

  /**
   * Map execution result based on hook type.
   */
  map(hook: HookDefinition, result: HookExecutionResult): MappedResult {
    if (hook.outputFormat === 'text') {
      return this.mapTextHook(hook as TextHook, result);
    } else {
      return this.mapStructuredHook(hook as StructuredHook, result);
    }
  }

  /**
   * Map exit codes to flow control actions for Text hooks.
   */
  private mapTextHook(hook: TextHook, result: HookExecutionResult): MappedResult {
    const exitCode = result.exitCode?.toString() || '1';
    
    // Check specific exit code mapping
    let flowControl = hook.exitCodeMap[exitCode];
    
    // Fall back to 'default' if specified
    if (!flowControl && hook.exitCodeMap['default']) {
      flowControl = hook.exitCodeMap['default'];
    }
    
    // Final fallback based on standard convention
    if (!flowControl) {
      if (result.exitCode === 0) {
        flowControl = 'success';
      } else if (result.exitCode === 2) {
        flowControl = 'blocking-error';
      } else {
        flowControl = 'non-blocking-error';
      }
    }

    // Build message
    let message = hook.message;
    if (result.timedOut) {
      message = `${message} (timed out after ${hook.timeout || 30000}ms)`;
    }
    if (result.truncated) {
      message = `${message} (output truncated)`;
    }

    return {
      flowControl,
      message,
      rawOutput: result.stdout || result.stderr || ''
    };
  }

  /**
   * Parse JSON output for Structured hooks.
   */
  private mapStructuredHook(hook: StructuredHook, result: HookExecutionResult): MappedResult {
    // Default to success for exit code 0, blocking error for 2, non-blocking otherwise
    let flowControl: FlowControlAction = 'success';
    if (result.exitCode === 2) {
      flowControl = 'blocking-error';
    } else if (result.exitCode !== 0) {
      flowControl = 'non-blocking-error';
    }

    // Try to parse JSON output
    let diagnostics: DiagnosticReport | undefined;
    
    if (result.stdout) {
      try {
        const parsed = JSON.parse(result.stdout);
        
        // Validate it matches DiagnosticReport structure
        if (this.isDiagnosticReport(parsed)) {
          diagnostics = parsed;
          
          // Override flow control based on report
          if (parsed.controlFlow?.decision === 'block') {
            flowControl = 'blocking-error';
          } else if (!parsed.success) {
            flowControl = 'non-blocking-error';
          } else {
            flowControl = 'success';
          }
        }
      } catch (err) {
        this.logger.logWarning(`Failed to parse structured output from ${hook.name}: ${err}`);
      }
    }

    // Build message for timeout/truncation
    let message: string | undefined;
    if (result.timedOut) {
      message = `Hook timed out after ${hook.timeout || 30000}ms`;
    }
    if (result.truncated) {
      message = message ? `${message} (output truncated)` : 'Output truncated';
    }

    return {
      flowControl,
      message,
      diagnostics,
      rawOutput: result.stdout || result.stderr || ''
    };
  }

  /**
   * Type guard to check if an object is a DiagnosticReport.
   */
  private isDiagnosticReport(obj: any): obj is DiagnosticReport {
    if (!obj || typeof obj !== 'object') return false;
    
    // Check required fields
    if (typeof obj.success !== 'boolean') return false;
    if (!Array.isArray(obj.findings)) return false;
    
    // Validate findings structure
    for (const finding of obj.findings) {
      if (!finding || typeof finding !== 'object') return false;
      if (typeof finding.file !== 'string') return false;
      if (typeof finding.line !== 'number') return false;
      if (typeof finding.message !== 'string') return false;
      if (finding.severity !== 'error' && finding.severity !== 'warning') return false;
    }
    
    // Validate optional controlFlow
    if (obj.controlFlow !== undefined) {
      if (typeof obj.controlFlow !== 'object') return false;
      if (obj.controlFlow.continue !== undefined && typeof obj.controlFlow.continue !== 'boolean') return false;
      if (typeof obj.controlFlow.reason !== 'string') return false;
      if (obj.controlFlow.decision !== undefined && obj.controlFlow.decision !== 'block') return false;
    }
    
    return true;
  }
}