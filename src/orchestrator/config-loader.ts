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
      return this.validate(rawConfig);
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
  validate(config: unknown): HooksConfigFile {
    if (!config || typeof config !== 'object') {
      throw new ConfigValidationError('unknown', ['Configuration must be an object']);
    }

    const cfg = config as any;

    // Validate optional logging config
    if (cfg.logging !== undefined) {
      if (typeof cfg.logging !== 'object') {
        throw new ConfigValidationError('unknown', ['logging must be an object']);
      }
      if (!cfg.logging.level || !ConfigLoader.VALID_LOG_LEVELS.has(cfg.logging.level)) {
        throw new ConfigValidationError('unknown', [`logging.level must be one of: ${Array.from(ConfigLoader.VALID_LOG_LEVELS).join(', ')}`]);
      }
      if (cfg.logging.path !== undefined && typeof cfg.logging.path !== 'string') {
        throw new ConfigValidationError('unknown', ['logging.path must be a string']);
      }
    }

    // Validate hooks array
    if (!Array.isArray(cfg.hooks)) {
      throw new ConfigValidationError('unknown', ['hooks must be an array']);
    }

    const validatedHooks: HookDefinition[] = [];
    for (let i = 0; i < cfg.hooks.length; i++) {
      const hook = cfg.hooks[i];
      try {
        validatedHooks.push(this.validateHook(hook));
      } catch (error) {
        throw new ConfigValidationError('unknown', [`Invalid hook at index ${i}: ${error}`]);
      }
    }

    return {
      logging: cfg.logging,
      hooks: validatedHooks
    };
  }

  /**
   * Get active hooks for a specific event, sorted by priority.
   */
  getActiveHooks(config: HooksConfigFile, event: ClaudeEventName): HookDefinition[] {
    const hooks = config.hooks
      .filter(hook => hook.events.includes(event))
      .sort((a, b) => {
        const aPriority = a.priority ?? DEFAULT_HOOK_PRIORITY;
        const bPriority = b.priority ?? DEFAULT_HOOK_PRIORITY;
        return aPriority - bPriority; // Lower number = higher priority
      });
    
    return hooks;
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

    if (hook.priority !== undefined) {
      if (typeof hook.priority !== 'number' || hook.priority < 0) {
        throw new Error('priority must be a non-negative number');
      }
    }

    if (hook.timeout !== undefined) {
      if (typeof hook.timeout !== 'number' || hook.timeout <= 0) {
        throw new Error('timeout must be a positive number');
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
      priority: hook.priority,
      timeout: hook.timeout,
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
      priority: hook.priority,
      timeout: hook.timeout,
      outputFormat: 'structured'
    };
  }
}