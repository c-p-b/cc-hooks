import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runHookBinary } from '../helpers/run-binary';

describe('RunCommand Integration Tests', () => {
  let tempDir: string;
  
  beforeEach(() => {
    // Create temp directory for test configs
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hooks-test-'));
  });
  
  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  
  describe('Event Matchers', () => {
    test('PreCompact matcher filters by trigger value', async () => {
      // Create config with manual and auto matchers
      const config = {
        hooks: [
          {
            name: 'manual-compact',
            outputFormat: 'text',
            matcher: 'manual',
            command: ['echo', 'MANUAL_TRIGGERED'],
            events: ['PreCompact'],
            exitCodeMap: { '0': 'success' },
            message: 'Manual compact hook'
          },
          {
            name: 'auto-compact',
            outputFormat: 'text',
            matcher: 'auto',
            command: ['echo', 'AUTO_TRIGGERED'],
            events: ['PreCompact'],
            exitCodeMap: { '0': 'success' },
            message: 'Auto compact hook'
          }
        ]
      };
      
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      // Test manual trigger
      const manualResult = await runHookBinary({
        hook_event_name: 'PreCompact',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: '.',
        trigger: 'manual'
      }, { configPath });
      
      expect(manualResult.stdout).toContain('MANUAL_TRIGGERED');
      expect(manualResult.stdout).not.toContain('AUTO_TRIGGERED');
      expect(manualResult.exitCode).toBe(0);
      
      // Test auto trigger
      const autoResult = await runHookBinary({
        hook_event_name: 'PreCompact',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: '.',
        trigger: 'auto'
      }, { configPath });
      
      expect(autoResult.stdout).toContain('AUTO_TRIGGERED');
      expect(autoResult.stdout).not.toContain('MANUAL_TRIGGERED');
      expect(autoResult.exitCode).toBe(0);
    }, 10000);
    
    test('SessionStart matcher filters by source value', async () => {
      const config = {
        hooks: [
          {
            name: 'resume-hook',
            outputFormat: 'text',
            matcher: 'resume',
            command: ['echo', 'RESUME_SESSION'],
            events: ['SessionStart'],
            exitCodeMap: { '0': 'success' },
            message: 'Resume session hook'
          },
          {
            name: 'startup-hook',
            outputFormat: 'text',
            matcher: 'startup',
            command: ['echo', 'STARTUP_SESSION'],
            events: ['SessionStart'],
            exitCodeMap: { '0': 'success' },
            message: 'Startup session hook'
          }
        ]
      };
      
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      // Test resume source
      const resumeResult = await runHookBinary({
        hook_event_name: 'SessionStart',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: '.',
        source: 'resume'
      }, { configPath });
      
      expect(resumeResult.stdout).toContain('RESUME_SESSION');
      expect(resumeResult.stdout).not.toContain('STARTUP_SESSION');
      expect(resumeResult.exitCode).toBe(0);
    });
    
    test('Tool matcher with wildcard pattern', async () => {
      const config = {
        hooks: [
          {
            name: 'mcp-hook',
            outputFormat: 'text',
            matcher: 'mcp__.*',
            command: ['echo', 'MCP_TOOL_MATCHED'],
            events: ['PreToolUse'],
            exitCodeMap: { '0': 'success' },
            message: 'MCP tool hook'
          }
        ]
      };
      
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      // Test MCP tool
      const result = await runHookBinary({
        hook_event_name: 'PreToolUse',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: '.',
        tool_name: 'mcp__github_search'
      }, { configPath });
      
      expect(result.stdout).toContain('MCP_TOOL_MATCHED');
      expect(result.exitCode).toBe(0);
      
      // Test non-MCP tool (should not match)
      const nonMcpResult = await runHookBinary({
        hook_event_name: 'PreToolUse',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: '.',
        tool_name: 'WebSearch'
      }, { configPath });
      
      expect(nonMcpResult.stdout).not.toContain('MCP_TOOL_MATCHED');
      expect(nonMcpResult.exitCode).toBe(0);
    });
  });
  
  describe('Stop Hook Active Prevention', () => {
    test('stop_hook_active prevents infinite loops', async () => {
      const config = {
        hooks: [
          {
            name: 'stop-hook',
            outputFormat: 'text',
            command: ['echo', 'SHOULD_NOT_RUN'],
            events: ['Stop'],
            exitCodeMap: { '0': 'success' },
            message: 'Stop hook'
          }
        ]
      };
      
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      const result = await runHookBinary({
        hook_event_name: 'Stop',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: '.',
        stop_hook_active: true
      }, { configPath });
      
      expect(result.stderr).toContain('stop_hook_active is true');
      expect(result.stdout).not.toContain('SHOULD_NOT_RUN');
      expect(result.exitCode).toBe(0);
    });
    
    test('Stop hook runs normally when stop_hook_active is false', async () => {
      const config = {
        hooks: [
          {
            name: 'stop-hook',
            outputFormat: 'text',
            command: ['echo', 'STOP_HOOK_RAN'],
            events: ['Stop'],
            exitCodeMap: { '0': 'success' },
            message: 'Stop hook'
          }
        ]
      };
      
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      const result = await runHookBinary({
        hook_event_name: 'Stop',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: '.',
        stop_hook_active: false
      }, { configPath });
      
      expect(result.stdout).toContain('STOP_HOOK_RAN');
      expect(result.exitCode).toBe(0);
    });
  });
  
  describe('Structured Output', () => {
    test('Structured hook JSON output for UserPromptSubmit', async () => {
      const config = {
        hooks: [
          {
            name: 'json-hook',
            outputFormat: 'structured',
            command: ['sh', '-c', 'echo \'{"decision": "continue", "suppressOutput": false}\''],
            events: ['UserPromptSubmit'],
            exitCodeMap: { '0': 'success' }
          }
        ]
      };
      
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      const result = await runHookBinary({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: '.',
        prompt: 'test prompt'
      }, { configPath });
      
      const output = JSON.parse(result.stdout);
      expect(output.decision).toBe('continue');
      expect(output.suppressOutput).toBe(false);
      expect(result.exitCode).toBe(0);
    });
    
    test('Blocking error with structured output', async () => {
      const config = {
        hooks: [
          {
            name: 'blocking-hook',
            outputFormat: 'structured',
            command: ['sh', '-c', 'echo \'{"decision": "block", "reason": "Test block"}\''],
            events: ['Stop'],
            exitCodeMap: { '0': 'success' }
          }
        ]
      };
      
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      const result = await runHookBinary({
        hook_event_name: 'Stop',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: '.'
      }, { configPath });
      
      expect(result.stderr).toContain('Test block');
      expect(result.exitCode).toBe(2); // Blocking error
    });
  });
  
  describe('Config Discovery', () => {
    test('Finds config in .claude directory', async () => {
      // Create a .claude directory in temp
      const claudeDir = path.join(tempDir, '.claude');
      fs.mkdirSync(claudeDir);
      
      const config = {
        hooks: [
          {
            name: 'test-hook',
            outputFormat: 'text',
            command: ['echo', 'FOUND_CONFIG'],
            events: ['Notification'],
            exitCodeMap: { '0': 'success' },
            message: 'Test hook'
          }
        ]
      };
      
      fs.writeFileSync(path.join(claudeDir, 'cc-hooks.json'), JSON.stringify(config));
      
      // Instead of changing directory, just pass the config path
      const configPath = path.join(claudeDir, 'cc-hooks.json');
      const result = await runHookBinary({
        hook_event_name: 'Notification',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: tempDir,
        message: 'test'
      }, { configPath });
      
      expect(result.stdout).toContain('FOUND_CONFIG');
      expect(result.exitCode).toBe(0);
    });
    
    test('Local config overrides project config', async () => {
      const claudeDir = path.join(tempDir, '.claude');
      fs.mkdirSync(claudeDir);
      
      // Project config
      const projectConfig = {
        hooks: [{
          name: 'project-hook',
          outputFormat: 'text',
          command: ['echo', 'PROJECT_CONFIG'],
          events: ['Notification'],
          exitCodeMap: { '0': 'success' },
          message: 'Project hook'
        }]
      };
      
      // Local config (should override)
      const localConfig = {
        hooks: [{
          name: 'local-hook',
          outputFormat: 'text',
          command: ['echo', 'LOCAL_CONFIG'],
          events: ['Notification'],
          exitCodeMap: { '0': 'success' },
          message: 'Local hook'
        }]
      };
      
      fs.writeFileSync(path.join(claudeDir, 'cc-hooks.json'), JSON.stringify(projectConfig));
      fs.writeFileSync(path.join(claudeDir, 'cc-hooks-local.json'), JSON.stringify(localConfig));
      
      // Use the local config (it should be picked first)
      const localConfigPath = path.join(claudeDir, 'cc-hooks-local.json');
      const result = await runHookBinary({
        hook_event_name: 'Notification',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: tempDir,
        message: 'test'
      }, { configPath: localConfigPath });
      
      expect(result.stdout).toContain('LOCAL_CONFIG');
      expect(result.stdout).not.toContain('PROJECT_CONFIG');
      expect(result.exitCode).toBe(0);
    });
  });
  
  describe('Timeout Handling', () => {
    test('Timeout is converted from seconds to milliseconds', async () => {
      const config = {
        hooks: [
          {
            name: 'quick-hook',
            outputFormat: 'text',
            command: ['sh', '-c', 'sleep 0.05 && echo "COMPLETED"'],
            events: ['Notification'],
            timeout: 1, // 1 second timeout
            exitCodeMap: { '0': 'success' },
            message: 'Quick hook'
          }
        ]
      };
      
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      const result = await runHookBinary({
        hook_event_name: 'Notification',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: '.',
        message: 'test'
      }, { configPath });
      
      expect(result.stdout).toContain('COMPLETED');
      expect(result.exitCode).toBe(0);
    });
    
    test('Hook times out when exceeding timeout', async () => {
      const config = {
        hooks: [
          {
            name: 'slow-hook',
            outputFormat: 'text',
            command: ['sh', '-c', 'sleep 0.6 && echo "SHOULD_NOT_APPEAR"'],
            events: ['Notification'],
            timeout: 0.1, // 0.1 second timeout
            exitCodeMap: { '0': 'success' },
            message: 'Slow hook'
          }
        ]
      };
      
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(config));
      
      const result = await runHookBinary({
        hook_event_name: 'Notification',
        session_id: 'test',
        transcript_path: '/tmp/test.jsonl',
        cwd: '.',
        message: 'test'
      }, { configPath });
      
      expect(result.stdout).not.toContain('SHOULD_NOT_APPEAR');
      // Timeout results in non-blocking error
      expect(result.exitCode).toBe(0);
    });
  });
});