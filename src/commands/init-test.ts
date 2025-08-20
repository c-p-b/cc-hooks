import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { ClaudeHookEvent } from '../common/types';

export class InitTestCommand {
  private cwd: string;
  private testDir: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
    this.testDir = path.join(this.cwd, '.claude', 'cc-hooks', 'test-events');
  }

  async execute(): Promise<void> {
    console.log(chalk.cyan('🧪 Initializing test events...\n'));

    // Create directory structure
    fs.mkdirSync(this.testDir, { recursive: true });

    // Generate stub events
    const stubs = this.generateStubs();
    let created = 0;
    let skipped = 0;

    for (const [filename, event] of Object.entries(stubs)) {
      const filepath = path.join(this.testDir, filename);
      
      if (fs.existsSync(filepath)) {
        console.log(chalk.yellow(`⚠️  ${filename} already exists (skipping)`));
        skipped++;
        continue;
      }

      // Add helpful comments at the top
      const content = this.formatEventWithComments(filename, event);
      fs.writeFileSync(filepath, content, 'utf-8');
      console.log(chalk.green(`✓ Created ${filename}`));
      created++;
    }

    console.log('\n' + chalk.green(`✅ Created ${created} test events`));
    if (skipped > 0) {
      console.log(chalk.yellow(`⚠️  Skipped ${skipped} existing files`));
    }

    console.log(chalk.gray(`\nTest events created in: ${this.testDir}`));
    console.log(chalk.gray('Edit these files to match your specific test scenarios'));
    console.log(chalk.gray('Then run "cc-hooks test" to execute them'));
  }

  private generateStubs(): Record<string, ClaudeHookEvent> {
    const baseEvent = {
      session_id: 'test-session',
      transcript_path: '/tmp/test-transcript.jsonl',
      cwd: this.cwd
    };

    return {
      // File editing events
      'PostToolUse-Edit.json': {
        ...baseEvent,
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: {
          file_path: 'src/index.ts',
          old_string: 'const oldCode = 1',
          new_string: 'const newCode = 2'
        },
        tool_response: {
          success: true,
          filePath: 'src/index.ts'
        }
      },

      'PostToolUse-Write.json': {
        ...baseEvent,
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: {
          file_path: 'src/new-file.ts',
          content: 'export function hello() {\n  console.log("Hello, world!");\n}\n'
        },
        tool_response: {
          success: true,
          filePath: 'src/new-file.ts'
        }
      },

      'PostToolUse-MultiEdit.json': {
        ...baseEvent,
        hook_event_name: 'PostToolUse',
        tool_name: 'MultiEdit',
        tool_input: {
          file_path: 'src/index.ts',
          edits: [
            { old_string: 'import foo from "foo"', new_string: 'import bar from "bar"' },
            { old_string: 'const x = 1', new_string: 'const x = 2' }
          ]
        },
        tool_response: {
          success: true,
          filePath: 'src/index.ts',
          editCount: 2
        }
      },

      // Command execution
      'PreToolUse-Bash.json': {
        ...baseEvent,
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: {
          command: 'npm test',
          description: 'Run test suite'
        }
      },

      'PostToolUse-Bash.json': {
        ...baseEvent,
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: {
          command: 'npm test',
          description: 'Run test suite'
        },
        tool_response: {
          stdout: 'All tests passed!',
          stderr: '',
          exitCode: 0
        }
      },

      // File reading
      'PreToolUse-Read.json': {
        ...baseEvent,
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_input: {
          file_path: 'package.json'
        }
      },

      // Stop events
      'Stop.json': {
        ...baseEvent,
        hook_event_name: 'Stop',
        stop_hook_active: false
      },

      'SubagentStop.json': {
        ...baseEvent,
        hook_event_name: 'SubagentStop',
        stop_hook_active: false
      },

      // Session events
      'SessionStart.json': {
        ...baseEvent,
        hook_event_name: 'SessionStart',
        source: 'startup'
      },

      // User interaction
      'UserPromptSubmit.json': {
        ...baseEvent,
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Fix the type errors in my code'
      },

      // Notifications
      'Notification.json': {
        ...baseEvent,
        hook_event_name: 'Notification',
        message: 'Claude needs your permission to use Bash'
      },

      // Compact
      'PreCompact.json': {
        ...baseEvent,
        hook_event_name: 'PreCompact',
        trigger: 'manual',
        custom_instructions: ''
      }
    };
  }

  private formatEventWithComments(filename: string, event: ClaudeHookEvent): string {
    // JSON files can't have comments, so we'll put guidance in a special field
    const eventWithHelp = {
      _comment: `Test event: ${filename.replace('.json', '')}`,
      _help: this.getHelpText(event),
      ...event
    };

    return JSON.stringify(eventWithHelp, null, 2);
  }

  private getHelpText(event: ClaudeHookEvent): string {
    if (event.hook_event_name === 'PostToolUse' || event.hook_event_name === 'PreToolUse') {
      const toolName = (event as any).tool_name;
      if (toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit') {
        return 'Change file_path and content to match your test scenario';
      } else if (toolName === 'Bash') {
        return 'Change command to test your command validation';
      }
    } else if (event.hook_event_name === 'Stop') {
      return 'This event triggers when Claude finishes responding';
    } else if (event.hook_event_name === 'UserPromptSubmit') {
      return 'Change prompt to test your prompt validation';
    }
    return 'Edit this file to match your specific test scenario';
  }
}