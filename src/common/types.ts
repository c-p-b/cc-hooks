// --- Core Enums and Types ---
export type ClaudeEventName = 
  | 'PreToolUse' 
  | 'PostToolUse' 
  | 'Stop' 
  | 'UserPromptSubmit' 
  | 'Notification' 
  | 'SubagentStop' 
  | 'PreCompact' 
  | 'SessionStart';

export type FlowControlAction = 'success' | 'non-blocking-error' | 'blocking-error';
export type FindingSeverity = 'error' | 'warning';
export type LogLevel = 'off' | 'errors' | 'verbose';

// --- Configuration Models (On-Disk Schemas) ---

/** The top-level structure of the `cc-hooks.json` file. */
export interface HooksConfigFile {
  logging?: LoggingConfig;
  hooks: HookDefinition[];
}

/** Optional logging configuration. */
export interface LoggingConfig {
  level: LogLevel;
  path?: string; // Defaults to ./.claude/logs/cc-hooks.log
}

/** A discriminated union representing the two tiers of hook definitions. */
export type HookDefinition = TextHook | StructuredHook;

interface BaseHook {
  name: string;
  command: string[];
  description?: string;
  events: ClaudeEventName[];
  priority?: number; // Execution and reporting priority (default: 100, lower = higher priority)
  timeout?: number;  // Custom timeout in milliseconds (default: 30000)
}

/** Tier 1: Universal Text Hook. */
export interface TextHook extends BaseHook {
  outputFormat: 'text';
  exitCodeMap: { [key: string]: FlowControlAction }; // Allows 'default' key
  message: string;
  fixInstructions?: string;
}

/** Tier 2: Structured Diagnostic Hook. */
export interface StructuredHook extends BaseHook {
  outputFormat: 'structured';
}

// --- Runtime & Communication Models ---

/** The structured data Claude provides to our `run` command via stdin. */
export interface ClaudeHookEvent {
  hook_event_name: ClaudeEventName;
  session_id: string;
  transcript_path: string;
  cwd: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  message?: string;
  prompt?: string;
  trigger?: string;
  custom_instructions?: string;
  source?: string;
  stop_hook_active?: boolean;
}

/** The high-fidelity report returned by Tier 2 hooks. */
export interface DiagnosticReport {
  success: boolean;
  findings: Finding[];
  controlFlow?: ControlFlow; // Optional advanced flow control
}

export interface Finding {
  file: string;
  line: number;
  message: string;
  severity: FindingSeverity;
}

/** The advanced flow control object for power users. */
export interface ControlFlow {
  continue?: boolean;
  reason: string;
  decision?: 'block';
}

/** Resource limits configuration. */
export interface ResourceLimits {
  maxOutputBytes: number;  // Default: 1048576 (1MB)
  timeoutMs: number;       // Default: 30000 (30s)
}

/** Hook execution result with resource tracking. */
export interface HookExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated?: boolean;     // Indicates output was truncated
  timedOut?: boolean;      // Indicates hook timed out
}

/** Platform-specific configuration. */
export interface PlatformConfig {
  shell?: string;           // Platform-specific shell
  pathSeparator: string;    // / or \
  taskKillCommand?: string; // Windows-specific
}

/** Session log entry for debugging and visibility. */
export interface LogEntry {
  timestamp: string;
  session_id: string;
  hook: string;
  event: ClaudeEventName;
  exit_code: number | null;
  duration: number;
  truncated: boolean;
  timed_out: boolean;
  flow_control: FlowControlAction;
}