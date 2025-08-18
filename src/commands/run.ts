import { ClaudeHookEvent, HookDefinition } from '../common/types';
import { ConfigLoader } from '../orchestrator/config-loader';
import { HookExecutor, ExecutionContext, HookResult } from '../orchestrator/executor';
import { getLogger } from '../common/logger';
import { EXIT_SUCCESS, EXIT_BLOCKING_ERROR } from '../common/constants';
import { CCHooksError } from '../common/errors';
import * as fs from 'fs';
import * as path from 'path';

export interface RunOptions {
  event?: string;
  mockData?: string;
  config?: string;
  debug?: boolean;
}

export class RunCommand {
  private configLoader: ConfigLoader;
  private executor: HookExecutor;
  private logger = getLogger();

  constructor() {
    this.configLoader = new ConfigLoader();
    this.executor = new HookExecutor();
  }

  async execute(options: RunOptions = {}): Promise<void> {
    if (process.env.CC_HOOKS_DEBUG) {
      console.error('[DEBUG] RunCommand.execute started with options:', options);
    }
    
    let event: ClaudeHookEvent;
    let configPath: string | null;
    let config: any;
    let hooks: HookDefinition[];
    
    try {
      // Get event data from stdin or mock
      event = await this.getEventData(options);
      this.lastEvent = event;
      
      if (process.env.CC_HOOKS_DEBUG) {
        console.error('[DEBUG] Event received:', JSON.stringify(event));
      }
    } catch (error) {
      this.handleError(error);
      return;
    }
    
    // Check for infinite loop prevention (outside try-catch)
    if ((event.hook_event_name === 'Stop' || event.hook_event_name === 'SubagentStop') 
        && event.stop_hook_active) {
      console.error('[WARNING] stop_hook_active is true - skipping hooks to prevent infinite loop');
      process.exit(EXIT_SUCCESS);
      return;
    }
    
    // Load configuration (outside try-catch for process.exit)
    configPath = options.config || this.findConfigFile();
    if (!configPath) {
      // No config file = no hooks to run, short-circuit
      process.exit(EXIT_SUCCESS);
      return;
    }

    try {
      config = this.configLoader.load(configPath);
    } catch (error) {
      this.handleError(error);
      return;
    }
    
    // Determine match value based on event type
    let matchValue: string | undefined;
    if (event.hook_event_name === 'PreToolUse' || event.hook_event_name === 'PostToolUse') {
      matchValue = event.tool_name;
    } else if (event.hook_event_name === 'PreCompact') {
      matchValue = event.trigger;
    } else if (event.hook_event_name === 'SessionStart') {
      matchValue = event.source;
    }
    
    hooks = this.configLoader.getActiveHooks(config, event.hook_event_name, matchValue);
    
    if (process.env.CC_HOOKS_DEBUG) {
      console.error(`[DEBUG] Found ${hooks.length} hooks for ${event.hook_event_name}`);
    }
    
    if (hooks.length === 0) {
      // No hooks for this event, short-circuit (outside try-catch)
      process.exit(EXIT_SUCCESS);
      return;
    }

    let exitCode: number;
    try {
      // Log the event
      this.logger.logEvent(event);

      // Execute hooks in parallel
      const results = await this.executeHooks(hooks, event);
      
      // Determine the most severe result
      const finalResult = this.determineFinalResult(results);
      
      // Output based on result and get exit code
      exitCode = this.outputResult(finalResult);
      
    } catch (error) {
      this.handleError(error);
      return;
    }
    
    // Exit with the determined code (outside try-catch)
    process.exit(exitCode);
  }

  private async getEventData(options: RunOptions): Promise<ClaudeHookEvent> {
    if (options.mockData) {
      // Testing mode: read from file
      const mockPath = path.resolve(options.mockData);
      if (!fs.existsSync(mockPath)) {
        throw new CCHooksError(`Mock data file not found: ${mockPath}`);
      }
      const content = fs.readFileSync(mockPath, 'utf-8');
      return JSON.parse(content);
    } else if (options.event) {
      // Testing mode: create minimal event
      return {
        hook_event_name: options.event as any,
        session_id: 'manual-test',
        transcript_path: '',
        cwd: process.cwd(),
      };
    } else {
      // Production mode: read from stdin
      return await this.readStdin();
    }
  }

  private async readStdin(): Promise<ClaudeHookEvent> {
    return new Promise((resolve, reject) => {
      let data = '';
      
      // Set a timeout for stdin read
      const timeout = setTimeout(() => {
        reject(new CCHooksError('Timeout reading from stdin'));
      }, 5000);

      process.stdin.setEncoding('utf-8');
      
      process.stdin.on('data', (chunk) => {
        data += chunk;
      });
      
      process.stdin.on('end', () => {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (error) {
          reject(new CCHooksError(`Invalid JSON from stdin: ${error}`));
        }
      });
      
      process.stdin.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private findConfigFile(): string | null {
    // Check for cc-hooks.json in priority order (most specific first)
    const locations = [
      // Local (highest priority - local overrides)
      path.join(process.cwd(), '.claude', 'cc-hooks-local.json'),
      // Project
      path.join(process.cwd(), '.claude', 'cc-hooks.json'),
      // Global (lowest priority)
      path.join(process.env.HOME || '', '.claude', 'cc-hooks.json'),
    ];

    for (const location of locations) {
      if (fs.existsSync(location)) {
        return location;
      }
    }

    return null;
  }

  private async executeHooks(
    hooks: HookDefinition[],
    event: ClaudeHookEvent
  ): Promise<HookResult[]> {
    // Create execution context
    const context: ExecutionContext = {
      event,
      resourceLimits: undefined, // Use defaults
    };

    // Execute all hooks in parallel
    const executions = hooks.map(async (hook) => {
      this.logger.logHookStart(hook);
      
      try {
        const result = await this.executor.execute(hook, context);
        
        // Log hook result
        this.logger.logHookResult(hook, {
          success: result.flowControl === 'success',
          exitCode: result.exitCode || undefined,
        });
        
        return result;
      } catch (error) {
        // Log hook failure
        this.logger.logHookResult(hook, {
          success: false,
          error: error as Error,
        });
        
        // Return a failed result instead of throwing
        return {
          hook,
          flowControl: 'non-blocking-error' as const,
          message: error instanceof Error ? error.message : 'Unknown error',
          rawOutput: '',
          duration: 0,
          exitCode: -1,
          signal: null,
          timedOut: false,
          truncated: false,
        } as HookResult;
      }
    });

    // Wait for all to complete
    return Promise.all(executions);
  }

  private determineFinalResult(results: HookResult[]): HookResult | null {
    // Priority: blocking-error > non-blocking-error > success
    // Also prioritize by hook priority (lower number = higher priority)
    
    const sortedResults = [...results].sort((a, b) => {
      // First sort by flow control severity
      const severityOrder = { 
        'blocking-error': 0, 
        'non-blocking-error': 1, 
        'success': 2 
      };
      const severityDiff = severityOrder[a.flowControl] - severityOrder[b.flowControl];
      if (severityDiff !== 0) return severityDiff;
      
      // Then by hook priority
      const aPriority = a.hook.priority ?? 100;
      const bPriority = b.hook.priority ?? 100;
      return aPriority - bPriority;
    });

    return sortedResults[0] || null;
  }

  private outputResult(result: HookResult | null): number {
    if (!result) {
      return EXIT_SUCCESS;
    }

    const event = this.lastEvent;
    
    // Special handling for UserPromptSubmit and SessionStart
    if (event && (event.hook_event_name === 'UserPromptSubmit' || event.hook_event_name === 'SessionStart')) {
      if (result.flowControl === 'success') {
        // For these events, stdout becomes context
        if (result.hook.outputFormat === 'structured') {
          // Use the structured output handler which properly wraps the output
          this.handleStructuredOutput(result);
        } else if (result.rawOutput) {
          // For text hooks, raw output becomes context
          console.log(result.rawOutput);
        }
        return EXIT_SUCCESS;
      }
    }

    // Handle blocking errors (exit code 2)
    if (result.flowControl === 'blocking-error') {
      const message = this.getErrorMessage(result);
      
      // For exit code 2, stderr is sent to Claude
      console.error(message);
      
      // Add fix instructions if available (for Text hooks)
      if (result.hook.outputFormat === 'text' && result.hook.fixInstructions) {
        console.error(`\nFix: ${result.hook.fixInstructions}`);
      }
      
      return EXIT_BLOCKING_ERROR;
    } else if (result.flowControl === 'non-blocking-error') {
      // Non-blocking error - show to user but continue
      const message = this.getErrorMessage(result);
      console.error(message);
      
      // Still exit 0 for non-blocking errors (Claude continues)
      return EXIT_SUCCESS;
    } else {
      // Success - check for special JSON output
      if (result.hook.outputFormat === 'structured' && result.jsonOutput) {
        this.handleStructuredOutput(result);
      } else if (result.rawOutput) {
        console.log(result.rawOutput);
      }
      return EXIT_SUCCESS;
    }
  }
  
  private getErrorMessage(result: HookResult): string {
    if (result.message) {
      return result.message;
    }
    if (result.hook.outputFormat === 'text') {
      return result.hook.message;
    }
    return result.flowControl === 'blocking-error' ? 'Hook execution blocked' : 'Hook execution failed';
  }
  
  private handleStructuredOutput(result: HookResult): void {
    const json = result.jsonOutput;
    if (!json) return;
    
    const event = this.lastEvent;
    
    // Build the output based on event type and fields present
    const output: any = {};
    
    // Handle PreToolUse permission decision
    if (event?.hook_event_name === 'PreToolUse' && json.permissionDecision) {
      output.hookSpecificOutput = {
        hookEventName: 'PreToolUse',
        permissionDecision: json.permissionDecision,
        permissionDecisionReason: json.permissionDecisionReason
      };
      // Include deprecated fields if present
      if (json.decision) output.decision = json.decision;
      if (json.reason) output.reason = json.reason;
    }
    // Handle UserPromptSubmit with additionalContext
    else if (event?.hook_event_name === 'UserPromptSubmit') {
      if (json.additionalContext) {
        output.hookSpecificOutput = {
          hookEventName: 'UserPromptSubmit',
          additionalContext: json.additionalContext
        };
      }
      if (json.decision) output.decision = json.decision;
      if (json.reason) output.reason = json.reason;
    }
    // Handle SessionStart with additionalContext
    else if (event?.hook_event_name === 'SessionStart' && json.additionalContext) {
      output.hookSpecificOutput = {
        hookEventName: 'SessionStart',
        additionalContext: json.additionalContext
      };
    }
    // For all other events or when no special fields, pass through as-is
    else {
      console.log(JSON.stringify(json));
      return;
    }
    
    // Add any other fields from the original JSON
    Object.keys(json).forEach(key => {
      if (!['permissionDecision', 'permissionDecisionReason', 'additionalContext', 'decision', 'reason'].includes(key)) {
        output[key] = json[key];
      }
    });
    
    console.log(JSON.stringify(output));
  }
  
  private lastEvent: ClaudeHookEvent | undefined;

  private handleError(error: unknown): void {
    if (error instanceof CCHooksError) {
      console.error(error.message);
      process.exit(error.name === 'BlockingError' ? EXIT_BLOCKING_ERROR : 1);
    } else if (error instanceof Error) {
      console.error(`Unexpected error: ${error.message}`);
      if (process.env.CC_HOOKS_DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    } else {
      console.error('Unknown error occurred');
      process.exit(1);
    }
  }
}