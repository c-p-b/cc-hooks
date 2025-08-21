import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { ConfigLoader } from '../orchestrator/config-loader';
import { ClaudeHookEvent } from '../common/types';

export interface TestOptions {
  verbose?: boolean;
}

export class TestCommand {
  private cwd: string;
  private testDir: string;
  private configLoader: ConfigLoader;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
    this.testDir = path.join(this.cwd, '.claude', 'cc-hooks', 'test-events');
    this.configLoader = new ConfigLoader();
  }

  async execute(eventFile?: string, options: TestOptions = {}): Promise<void> {
    console.log(chalk.cyan('🧪 Testing hooks...\n'));

    // Check if test events exist
    if (!fs.existsSync(this.testDir) && !eventFile) {
      console.log(chalk.yellow('No test events found.'));
      console.log(chalk.gray('Run "cc-hooks init-test" to create test event files'));
      console.log(chalk.gray('Or specify an event file: cc-hooks test <file>'));
      return;
    }

    // Check if hooks are configured
    const configPath = this.findConfigFile();
    if (!configPath) {
      console.log(chalk.red('❌ No cc-hooks configuration found.'));
      console.log(chalk.gray('Run "cc-hooks init" first'));
      return;
    }

    const config = this.configLoader.load(configPath);
    if (config.hooks.length === 0) {
      console.log(chalk.yellow('⚠️  No hooks installed.'));
      console.log(chalk.gray('Run "cc-hooks install <template>" to add hooks'));
      return;
    }

    // Determine which files to test
    const files = eventFile ? [this.resolveEventFile(eventFile)] : this.getAllTestFiles();

    if (files.length === 0) {
      console.log(chalk.yellow('No test event files found.'));
      return;
    }

    // Track results
    const results = {
      passed: 0,
      failed: 0,
      skipped: 0,
    };

    // Test each event file
    for (const file of files) {
      await this.runTestFile(file, config, options, results);
    }

    // Summary
    console.log('\n' + chalk.bold('Test Summary:'));
    console.log(chalk.green(`  ✓ ${results.passed} passed`));
    if (results.failed > 0) {
      console.log(chalk.red(`  ✗ ${results.failed} failed`));
    }
    if (results.skipped > 0) {
      console.log(chalk.gray(`  - ${results.skipped} skipped`));
    }

    // Exit with appropriate code (only in production, not during tests)
    if (process.env.NODE_ENV !== 'test') {
      process.exit(results.failed > 0 ? 1 : 0);
    }
  }

  private async runTestFile(
    file: string,
    config: any,
    options: TestOptions,
    results: { passed: number; failed: number; skipped: number },
  ): Promise<void> {
    const fileName = path.basename(file);
    console.log(chalk.bold(`Testing: ${fileName}`));

    try {
      // Read event to determine which hooks will run
      const eventContent = fs.readFileSync(file, 'utf-8');
      const event: ClaudeHookEvent = JSON.parse(eventContent);

      // Find matching hooks
      const matchingHooks = this.getMatchingHooks(event, config);

      if (matchingHooks.length === 0) {
        console.log(chalk.gray('  No hooks configured for this event'));
        results.skipped++;
        return;
      }

      console.log(chalk.gray(`  Hooks: ${matchingHooks.map((h) => h.name).join(', ')}`));

      // Run cc-hooks run with the event via stdin
      try {
        const output = execSync('cc-hooks run', {
          input: eventContent,
          encoding: 'utf-8',
          stdio: options.verbose ? ['pipe', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, CC_HOOKS_TEST_MODE: '1' },
          timeout: 65000, // 65s - slightly more than hook timeout
        });

        // Check if stderr has content (non-blocking error)
        // Since execSync doesn't give us stderr separately when it succeeds,
        // we need to use a different approach
        console.log(chalk.green('  ✓ Passed'));
        results.passed++;

        if (options.verbose && output && !options.verbose) {
          console.log(chalk.gray('  Output:'));
          console.log(
            chalk.gray(
              output
                .split('\n')
                .map((l: string) => '    ' + l)
                .join('\n'),
            ),
          );
        }
      } catch (error: any) {
        const exitCode = error.status || 1;

        if (exitCode === 2) {
          // Blocking error - hooks blocked execution
          console.log(chalk.yellow('  ⚠️  Blocked (exit code 2)'));

          // Check if this is expected
          const hasBlockingHooks = matchingHooks.some(
            (h) =>
              h.outputFormat === 'text' &&
              h.exitCodeMap &&
              Object.values(h.exitCodeMap).includes('blocking-error'),
          );

          if (hasBlockingHooks) {
            console.log(chalk.gray('     Expected behavior - hooks can block on errors'));
            results.passed++;
          } else {
            console.log(chalk.gray('     Unexpected blocking'));
            results.failed++;
          }
        } else {
          console.log(chalk.red(`  ✗ Failed (exit code ${exitCode})`));
          results.failed++;
        }

        if (options.verbose && error.stderr) {
          console.log(chalk.red('  Error:'));
          console.log(
            chalk.gray(
              error.stderr
                .split('\n')
                .map((l: string) => '    ' + l)
                .join('\n'),
            ),
          );
        }
      }
    } catch (error) {
      console.log(chalk.red(`  ❌ Error: ${error}`));
      results.failed++;
    }

    console.log(); // Blank line between tests
  }

  private getMatchingHooks(event: ClaudeHookEvent, config: any): any[] {
    const hooks = config.hooks || [];

    return hooks.filter((hook: any) => {
      // Check if event type matches
      if (!hook.events.includes(event.hook_event_name)) return false;

      // Check matcher for tool events
      if (
        (event.hook_event_name === 'PreToolUse' || event.hook_event_name === 'PostToolUse') &&
        hook.matcher
      ) {
        const toolName = (event as any).tool_name;
        if (!toolName) return false;

        if (hook.matcher === '*') return true;

        try {
          const regex = new RegExp(hook.matcher);
          return regex.test(toolName);
        } catch {
          return hook.matcher === toolName;
        }
      }

      return true;
    });
  }

  private resolveEventFile(eventFile: string): string {
    // If absolute path, use as-is
    if (path.isAbsolute(eventFile)) {
      return eventFile;
    }

    // If relative path starting with ./, resolve from cwd
    if (eventFile.startsWith('./')) {
      return path.resolve(this.cwd, eventFile);
    }

    // Check in test-events directory
    const inTestDir = path.join(this.testDir, eventFile);
    if (fs.existsSync(inTestDir)) {
      return inTestDir;
    }

    // Try adding .json extension
    if (!eventFile.endsWith('.json')) {
      const withJson = `${eventFile}.json`;
      const inTestDirWithJson = path.join(this.testDir, withJson);
      if (fs.existsSync(inTestDirWithJson)) {
        return inTestDirWithJson;
      }
    }

    // Fall back to current directory
    return path.resolve(this.cwd, eventFile);
  }

  private getAllTestFiles(): string[] {
    if (!fs.existsSync(this.testDir)) {
      return [];
    }

    return fs
      .readdirSync(this.testDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(this.testDir, f))
      .sort();
  }

  private findConfigFile(): string | null {
    const locations = [
      path.join(this.cwd, '.claude', 'cc-hooks-local.json'),
      path.join(this.cwd, '.claude', 'cc-hooks.json'),
      path.join(this.cwd, 'cc-hooks.json'),
      path.join(process.env.HOME || '', '.claude', 'cc-hooks.json'),
    ];

    for (const location of locations) {
      if (fs.existsSync(location)) {
        return location;
      }
    }

    return null;
  }
}
