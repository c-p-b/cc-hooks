import { readFileSync, existsSync } from 'fs';
import { 
  HooksConfigFile, 
  HookDefinition, 
  ClaudeEventName,
  TextHook,
  StructuredHook,
  FlowControlAction,
  LogLevel
} from '../common/types';
import { ConfigValidationError } from '../common/errors';
import { DEFAULT_HOOK_PRIORITY } from '../common/constants';

export class ConfigLoader {
  private static readonly VALID_EVENTS = new Set<ClaudeEventName>([
    'PreToolUse',
    'PostToolUse', 
    'Stop',
    'UserPromptSubmit',
    'Notification',
    'SubagentStop',
    'PreCompact',
    'SessionStart'
  ]);

  private static readonly VALID_OUTPUT_FORMATS = new Set(['text', 'structured']);
  private static readonly VALID_FLOW_CONTROLS = new Set<FlowControlAction>(['success', 'non-blocking-error', 'blocking-error']);
  private static readonly VALID_LOG_LEVELS = new Set<LogLevel>(['off', 'errors', 'verbose']);

  /**
   * Load and validate a hooks configuration file.
   * Returns an empty config if the file doesn't exist.
   */
  load(path: string): HooksConfigFile {
    if (!existsSync(path)) {
      return { hooks: [] };
    }

    try {
      const content = readFileSync(path, 'utf-8');
      const rawConfig = JSON.parse(content);
      return this.validate(rawConfig, path);
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new ConfigValidationError(path, [`Invalid JSON: ${error.message}`]);
      }
      throw new ConfigValidationError(path, [`Failed to load: ${error}`]);
    }
  }

  /**
   * Validate a configuration object and return a typed HooksConfigFile.
   * Throws ConfigValidationError if validation fails.
   */
  validate(config: unknown, configPath = 'config'): HooksConfigFile {
    if (!config || typeof config !== 'object') {
      throw new ConfigValidationError(configPath, ['Configuration must be an object']);
    }

    const cfg = config as any;

    // Validate optional logging config
    if (cfg.logging !== undefined) {
      if (typeof cfg.logging !== 'object') {
        throw new ConfigValidationError(configPath, ['logging must be an object']);
      }
      if (!cfg.logging.level || !ConfigLoader.VALID_LOG_LEVELS.has(cfg.logging.level)) {
        throw new ConfigValidationError(configPath, [`logging.level must be one of: ${Array.from(ConfigLoader.VALID_LOG_LEVELS).join(', ')}`]);
      }
      if (cfg.logging.path !== undefined && typeof cfg.logging.path !== 'string') {
        throw new ConfigValidationError(configPath, ['logging.path must be a string']);
      }
    }

    // Validate hooks array
    if (!Array.isArray(cfg.hooks)) {
      throw new ConfigValidationError(configPath, ['hooks must be an array']);
    }

    const validatedHooks: HookDefinition[] = [];
    for (let i = 0; i < cfg.hooks.length; i++) {
      const hook = cfg.hooks[i];
      try {
        validatedHooks.push(this.validateHook(hook));
      } catch (error) {
        throw new ConfigValidationError(configPath, [`Invalid hook at index ${i}: ${error}`]);
      }
    }

    return {
      logging: cfg.logging,
      hooks: validatedHooks
    };
  }

  /**
   * Get active hooks for a specific event, sorted by priority.
   * Applies appropriate matcher filtering based on event type.
   */
  getActiveHooks(
    config: HooksConfigFile, 
    event: ClaudeEventName,
    matchValue?: string  // tool name, trigger, or source depending on event
  ): HookDefinition[] {
    let hooks = config.hooks.filter(hook => hook.events.includes(event));
    
    // Apply matcher filtering based on event type
    if (matchValue) {
      if (event === 'PreToolUse' || event === 'PostToolUse') {
        // Match tool names
        hooks = hooks.filter(hook => {
          const matches = this.matchesTool(hook.matcher, matchValue);
          if (process.env.CC_HOOKS_DEBUG) {
            console.error(`Hook ${hook.name} matcher="${hook.matcher}" tool="${matchValue}" matches=${matches}`);
          }
          return matches;
        });
      } else if (event === 'PreCompact' || event === 'SessionStart') {
        // Match trigger/source values
        hooks = hooks.filter(hook => {
          const matches = this.matchesValue(hook.matcher, matchValue);
          if (process.env.CC_HOOKS_DEBUG) {
            console.error(`Hook ${hook.name} matcher="${hook.matcher}" value="${matchValue}" matches=${matches}`);
          }
          return matches;
        });
      }
      // Other events (Stop, UserPromptSubmit, Notification) don't use matchers
    }
    
    // Sort by priority (lower number = higher priority)
    hooks.sort((a, b) => {
      const aPriority = a.priority ?? DEFAULT_HOOK_PRIORITY;
      const bPriority = b.priority ?? DEFAULT_HOOK_PRIORITY;
      return aPriority - bPriority;
    });
    
    return hooks;
  }
  
  /**
   * Check if a hook's matcher matches a simple value (for PreCompact/SessionStart).
   */
  private matchesValue(matcher: string | undefined, value: string): boolean {
    // No matcher means hook runs for all values (backwards compatibility)
    if (matcher === undefined || matcher === null) {
      return true;
    }
    
    // "*" or empty string matches all
    if (matcher === '*' || matcher === '') {
      return true;
    }
    
    // Simple string match
    return matcher === value;
  }
  
  /**
   * Check if a hook's matcher pattern matches the given tool name.
   */
  private matchesTool(matcher: string | undefined, toolName: string): boolean {
    // No matcher means hook runs for all tools (backwards compatibility)
    if (matcher === undefined || matcher === null) {
      return true;
    }
    
    // "*" or empty string matches all tools
    if (matcher === '*' || matcher === '') {
      return true;
    }
    
    // Try as regex pattern
    try {
      // If pattern already has anchors, use as-is
      // Otherwise, add anchors for exact matching
      const pattern = matcher.startsWith('^') || matcher.endsWith('$') 
        ? matcher 
        : `^${matcher}$`;
      const regex = new RegExp(pattern);
      return regex.test(toolName);
    } catch {
      // If not valid regex, treat as literal string match
      return matcher === toolName;
    }
  }

  private validateHook(hook: any): HookDefinition {
    // Validate required base fields
    if (!hook.name || typeof hook.name !== 'string') {
      throw new Error('name is required and must be a string');
    }

    if (!Array.isArray(hook.command) || hook.command.length === 0) {
      throw new Error('command must be a non-empty array');
    }

    if (!hook.command.every((c: any) => typeof c === 'string')) {
      throw new Error('command array must contain only strings');
    }

    if (!Array.isArray(hook.events) || hook.events.length === 0) {
      throw new Error('events must be a non-empty array');
    }

    for (const event of hook.events) {
      if (!ConfigLoader.VALID_EVENTS.has(event)) {
        throw new Error(`Invalid event '${event}'. Must be one of: ${Array.from(ConfigLoader.VALID_EVENTS).join(', ')}`);
      }
    }

    if (!hook.outputFormat || !ConfigLoader.VALID_OUTPUT_FORMATS.has(hook.outputFormat)) {
      throw new Error(`outputFormat must be one of: ${Array.from(ConfigLoader.VALID_OUTPUT_FORMATS).join(', ')}`);
    }

    // Validate optional fields
    if (hook.description !== undefined && typeof hook.description !== 'string') {
      throw new Error('description must be a string');
    }
    
    if (hook.matcher !== undefined && typeof hook.matcher !== 'string') {
      throw new Error('matcher must be a string');
    }

    if (hook.priority !== undefined) {
      if (typeof hook.priority !== 'number' || hook.priority < 0) {
        throw new Error('priority must be a non-negative number');
      }
    }

    if (hook.timeout !== undefined) {
      if (typeof hook.timeout !== 'number' || hook.timeout <= 0) {
        throw new Error('timeout must be a positive number (in seconds)');
      }
    }

    // Type-specific validation
    if (hook.outputFormat === 'text') {
      return this.validateTextHook(hook);
    } else {
      return this.validateStructuredHook(hook);
    }
  }

  private validateTextHook(hook: any): TextHook {
    if (!hook.exitCodeMap || typeof hook.exitCodeMap !== 'object') {
      throw new Error('Text hooks must have an exitCodeMap object');
    }

    // Validate exit code map values
    for (const [code, action] of Object.entries(hook.exitCodeMap)) {
      if (!ConfigLoader.VALID_FLOW_CONTROLS.has(action as FlowControlAction)) {
        throw new Error(`Invalid flow control '${action}' for exit code '${code}'. Must be one of: ${Array.from(ConfigLoader.VALID_FLOW_CONTROLS).join(', ')}`);
      }
    }

    if (!hook.message || typeof hook.message !== 'string') {
      throw new Error('Text hooks must have a message string');
    }

    if (hook.fixInstructions !== undefined && typeof hook.fixInstructions !== 'string') {
      throw new Error('fixInstructions must be a string');
    }

    return {
      name: hook.name,
      command: hook.command,
      description: hook.description,
      events: hook.events,
      matcher: hook.matcher,
      priority: hook.priority,
      timeout: hook.timeout ? hook.timeout * 1000 : undefined, // Convert seconds to milliseconds
      outputFormat: 'text',
      exitCodeMap: hook.exitCodeMap,
      message: hook.message,
      fixInstructions: hook.fixInstructions
    };
  }

  private validateStructuredHook(hook: any): StructuredHook {
    return {
      name: hook.name,
      command: hook.command,
      description: hook.description,
      events: hook.events,
      matcher: hook.matcher,
      priority: hook.priority,
      timeout: hook.timeout ? hook.timeout * 1000 : undefined, // Convert seconds to milliseconds
      outputFormat: 'structured'
    };
  }
}