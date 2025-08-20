import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Provides an isolated test environment without mutating global state.
 * This is the RIGHT way to test - no process.chdir(), no global env pollution.
 */
export class TestEnvironment {
  private tempDir: string;
  private originalEnv: NodeJS.ProcessEnv;
  private originalCwd: string;

  constructor() {
    this.tempDir = '';
    this.originalEnv = { ...process.env };
    this.originalCwd = process.cwd();
  }

  /**
   * Set up an isolated test directory
   */
  setup(): string {
    // Create unique temp directory
    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hooks-test-'));

    // Create .claude directory structure
    const claudeDir = path.join(this.tempDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });

    // Set environment to use this directory WITHOUT changing process.cwd()
    process.env.CLAUDE_PROJECT_DIR = this.tempDir;
    process.env.HOME = this.tempDir;

    return this.tempDir;
  }

  /**
   * Clean up test environment
   */
  cleanup(): void {
    // Restore original environment
    process.env = this.originalEnv;

    // Clean up temp directory
    if (this.tempDir && fs.existsSync(this.tempDir)) {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    }
  }

  /**
   * Get paths for test files
   */
  get paths() {
    return {
      root: this.tempDir,
      claude: path.join(this.tempDir, '.claude'),
      settings: path.join(this.tempDir, '.claude', 'settings.json'),
      config: path.join(this.tempDir, '.claude', 'cc-hooks.json'),
    };
  }

  /**
   * Run a function with the test directory as working directory
   * WITHOUT changing global process.cwd()
   */
  async inDirectory<T>(fn: () => Promise<T>): Promise<T> {
    // Commands will use CLAUDE_PROJECT_DIR which we've set
    // No need to change process.cwd()
    return fn();
  }

  /**
   * Write a file relative to the test directory
   */
  writeFile(relativePath: string, content: string): void {
    const fullPath = path.join(this.tempDir, relativePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  /**
   * Read a file relative to the test directory
   */
  readFile(relativePath: string): string {
    return fs.readFileSync(path.join(this.tempDir, relativePath), 'utf-8');
  }

  /**
   * Check if a file exists relative to the test directory
   */
  fileExists(relativePath: string): boolean {
    return fs.existsSync(path.join(this.tempDir, relativePath));
  }
}
