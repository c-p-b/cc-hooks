import { TemplatesCommand } from '../../src/commands/templates';

describe('Templates Command', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should list available templates and bundles', async () => {
    const command = new TemplatesCommand();
    await command.execute();

    // Should show the header
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Available templates')
    );

    // Should list the typescript bundle (single string arg)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('typescript - Complete TypeScript development suite')
    );

    // Should show included hooks for bundles
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Includes:')
    );

    // Should show install instructions (single concatenated string)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('To install:')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('cc-hooks install <template-name>')
    );
  });

  it('should handle missing templates directory gracefully', async () => {
    // Create a TemplatesCommand with non-existent directory
    const command = new TemplatesCommand();
    // Override the private templatesDir to point to non-existent location
    (command as any).templatesDir = '/non/existent/templates/dir';
    
    await command.execute();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('No templates directory found')
    );
  });
});