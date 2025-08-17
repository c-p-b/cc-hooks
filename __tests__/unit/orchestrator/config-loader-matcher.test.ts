import { ConfigLoader } from '../../../src/orchestrator/config-loader';
import { HooksConfigFile } from '../../../src/common/types';

describe('ConfigLoader Matcher Patterns', () => {
  let loader: ConfigLoader;
  
  beforeEach(() => {
    loader = new ConfigLoader();
  });
  
  describe('Tool name matching', () => {
    const createConfig = (matcher: string): HooksConfigFile => ({
      hooks: [{
        name: 'test-hook',
        outputFormat: 'text',
        command: ['echo', 'test'],
        events: ['PreToolUse'],
        matcher,
        exitCodeMap: { '0': 'success' },
        message: 'Test hook'
      }]
    });
    
    test('matches OR patterns like Edit|Write', () => {
      const config = createConfig('Edit|Write');
      
      const editHooks = loader.getActiveHooks(config, 'PreToolUse', 'Edit');
      expect(editHooks).toHaveLength(1);
      
      const writeHooks = loader.getActiveHooks(config, 'PreToolUse', 'Write');
      expect(writeHooks).toHaveLength(1);
      
      const readHooks = loader.getActiveHooks(config, 'PreToolUse', 'Read');
      expect(readHooks).toHaveLength(0);
    });
    
    test('matches wildcard patterns like mcp__.*', () => {
      const config = createConfig('mcp__.*');
      
      const mcpGithub = loader.getActiveHooks(config, 'PreToolUse', 'mcp__github_search');
      expect(mcpGithub).toHaveLength(1);
      
      const mcpMemory = loader.getActiveHooks(config, 'PreToolUse', 'mcp__memory_store');
      expect(mcpMemory).toHaveLength(1);
      
      const regularTool = loader.getActiveHooks(config, 'PreToolUse', 'WebSearch');
      expect(regularTool).toHaveLength(0);
    });
    
    test('matches complex patterns like Notebook.*', () => {
      const config = createConfig('Notebook.*');
      
      const notebookEdit = loader.getActiveHooks(config, 'PreToolUse', 'NotebookEdit');
      expect(notebookEdit).toHaveLength(1);
      
      const notebookCreate = loader.getActiveHooks(config, 'PreToolUse', 'NotebookCreate');
      expect(notebookCreate).toHaveLength(1);
      
      const notebook = loader.getActiveHooks(config, 'PreToolUse', 'Notebook');
      expect(notebook).toHaveLength(1);
      
      const edit = loader.getActiveHooks(config, 'PreToolUse', 'Edit');
      expect(edit).toHaveLength(0);
    });
    
    test('matches exact tool names', () => {
      const config = createConfig('Write');
      
      const writeHooks = loader.getActiveHooks(config, 'PreToolUse', 'Write');
      expect(writeHooks).toHaveLength(1);
      
      const writeFileHooks = loader.getActiveHooks(config, 'PreToolUse', 'WriteFile');
      expect(writeFileHooks).toHaveLength(0);
    });
    
    test('handles custom anchored patterns', () => {
      const config = createConfig('^mcp__github.*search$');
      
      const match = loader.getActiveHooks(config, 'PreToolUse', 'mcp__github_search');
      expect(match).toHaveLength(1);
      
      const noMatch = loader.getActiveHooks(config, 'PreToolUse', 'mcp__github_search_repos');
      expect(noMatch).toHaveLength(0);
    });
    
    test('wildcard * matches all tools', () => {
      const config = createConfig('*');
      
      const anyTool = loader.getActiveHooks(config, 'PreToolUse', 'AnyToolName');
      expect(anyTool).toHaveLength(1);
    });
    
    test('no matcher matches all tools', () => {
      const config: HooksConfigFile = {
        hooks: [{
          name: 'test-hook',
          outputFormat: 'text',
          command: ['echo', 'test'],
          events: ['PreToolUse'],
          // No matcher field
          exitCodeMap: { '0': 'success' },
          message: 'Test hook'
        }]
      };
      
      const anyTool = loader.getActiveHooks(config, 'PreToolUse', 'AnyToolName');
      expect(anyTool).toHaveLength(1);
    });
  });
});